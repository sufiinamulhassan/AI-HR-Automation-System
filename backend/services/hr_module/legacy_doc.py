import io
import re
import struct

import olefile

OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
WORD_IDENT = 0xA5EC
MIN_NFIB = 0xC1
FLAG_ENCRYPTED = 0x0100
FLAG_TABLE_STREAM_1 = 0x0200
CLX_PAIR_INDEX = 33
FC_COMPRESSED = 0x40000000
MAX_STREAM_BYTES = 40 * 1024 * 1024

_FIELD_CODE = re.compile(r"\x13[^\x13\x14\x15]*[\x14\x15]")
_CONTROL = re.compile(r"[\x00-\x08\x0e-\x1f]")


def _u16(buf: bytes, pos: int) -> int:
    return struct.unpack_from("<H", buf, pos)[0]


def _u32(buf: bytes, pos: int) -> int:
    return struct.unpack_from("<I", buf, pos)[0]


def _read_streams(raw: bytes) -> tuple[bytes, bytes]:
    try:
        ole = olefile.OleFileIO(io.BytesIO(raw))
    except Exception as exc:
        raise ValueError("the file is damaged or is not a Word document") from exc
    try:
        if not ole.exists("WordDocument"):
            raise ValueError("this is not a Word document")
        if ole.get_size("WordDocument") > MAX_STREAM_BYTES:
            raise ValueError("the document is too large to read")
        word = ole.openstream("WordDocument").read()
        if len(word) < 0x200:
            raise ValueError("the document is damaged")
        flags = _u16(word, 0x0A)
        if flags & FLAG_ENCRYPTED:
            raise ValueError("the document is password protected")
        name = "1Table" if flags & FLAG_TABLE_STREAM_1 else "0Table"
        if not ole.exists(name):
            raise ValueError("the document is damaged")
        if ole.get_size(name) > MAX_STREAM_BYTES:
            raise ValueError("the document is too large to read")
        return word, ole.openstream(name).read()
    finally:
        ole.close()


def _fib(word: bytes) -> tuple[int, int, int]:
    if _u16(word, 0) != WORD_IDENT:
        raise ValueError("this is not a Word 97 to 2003 document")
    if _u16(word, 2) < MIN_NFIB:
        raise ValueError("this Word file is from a version older than Word 97")
    pos = 32
    csw = _u16(word, pos)
    pos += 2 + csw * 2
    cslw = _u16(word, pos)
    longs = pos + 2
    pos = longs + cslw * 4
    cb_fc_lcb = _u16(word, pos)
    pairs = pos + 2
    if cslw < 4 or cb_fc_lcb <= CLX_PAIR_INDEX:
        raise ValueError("the document is damaged")
    at = pairs + CLX_PAIR_INDEX * 8
    return _u32(word, longs + 3 * 4), _u32(word, at), _u32(word, at + 4)


def _pieces(table: bytes, fc_clx: int, lcb_clx: int) -> tuple[tuple[int, ...], bytes]:
    if not lcb_clx or fc_clx + lcb_clx > len(table):
        raise ValueError("the document is damaged")
    clx = table[fc_clx:fc_clx + lcb_clx]
    pos = 0
    while pos < len(clx) and clx[pos] == 1:
        pos += 3 + _u16(clx, pos + 1)
    if pos + 5 > len(clx) or clx[pos] != 2:
        raise ValueError("the document is damaged")
    size = _u32(clx, pos + 1)
    plc = clx[pos + 5:pos + 5 + size]
    count = (len(plc) - 4) // 12
    if count < 1:
        raise ValueError("the document is damaged")
    return struct.unpack_from(f"<{count + 1}I", plc, 0), plc


def _decode(word: bytes, positions: tuple[int, ...], plc: bytes, limit: int) -> str:
    count = len(positions) - 1
    parts: list[str] = []
    total = 0
    for i in range(count):
        length = positions[i + 1] - positions[i]
        if length <= 0:
            continue
        fc = _u32(plc, (count + 1) * 4 + i * 8 + 2)
        if fc & FC_COMPRESSED:
            start = (fc & ~FC_COMPRESSED) // 2
            text = word[start:start + length].decode("cp1252", errors="replace")
        else:
            text = word[fc:fc + length * 2].decode("utf-16-le", errors="replace")
        parts.append(text)
        total += len(text)
        if limit and total >= limit:
            break
    joined = "".join(parts)
    return joined[:limit] if limit else joined


def _tidy(text: str) -> str:
    while True:
        stripped = _FIELD_CODE.sub("", text)
        if stripped == text:
            break
        text = stripped
    text = text.replace("\x07\x07", "\n").replace("\x07", "\t")
    text = text.replace("\r", "\n").replace("\x0b", "\n").replace("\x0c", "\n")
    text = text.replace("\xa0", " ").replace("\x1e", "-").replace("\x1f", "")
    text = _CONTROL.sub("", text)
    lines = (line.rstrip() for line in text.split("\n"))
    return "\n".join(line for line in lines if line.strip())


def extract_doc_text(raw: bytes) -> str:
    if not raw.startswith(OLE_MAGIC):
        raise ValueError("this is not a Word 97 to 2003 document")
    try:
        word, table = _read_streams(raw)
        ccp_text, fc_clx, lcb_clx = _fib(word)
        positions, plc = _pieces(table, fc_clx, lcb_clx)
        return _tidy(_decode(word, positions, plc, ccp_text))
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("the document is damaged") from exc
