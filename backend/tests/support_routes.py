from __future__ import annotations

from dataclasses import dataclass, field

from fastapi.routing import APIRoute

from main import app

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}

TENANT_GUARDS = {"get_current_user", "require_admin", "require_superadmin"}
PLATFORM_GUARD = "require_platform_admin"


@dataclass
class RouteInfo:
    path: str
    methods: frozenset
    name: str
    module: str
    roles: set = field(default_factory=set)
    permissions: set = field(default_factory=set)
    throttled: bool = False

    @property
    def authenticated(self) -> bool:
        return bool(self.roles)

    @property
    def admin_gated(self) -> bool:
        return bool(self.roles & {"require_admin", "require_superadmin"})

    @property
    def platform_gated(self) -> bool:
        return "require_platform_admin" in self.roles

    @property
    def tenant_guarded(self) -> bool:
        return bool(self.roles & TENANT_GUARDS) or bool(self.permissions)

    @property
    def label(self) -> str:
        return f"{','.join(sorted(self.methods))} {self.path}"


def _walk(dependant, info: RouteInfo) -> None:
    for sub in dependant.dependencies:
        call = sub.call
        name = getattr(call, "__name__", "")
        if name in TENANT_GUARDS or name == PLATFORM_GUARD:
            info.roles.add(name)
        elif name in ("_check_permission", "_check_any_permission"):
            for cell in call.__closure__ or ():
                value = cell.cell_contents
                if isinstance(value, str):
                    info.permissions.add(value)
                elif isinstance(value, tuple):
                    info.permissions.update(v for v in value if isinstance(v, str))
        elif name == "_throttle" and getattr(call, "__module__", "") == "shared.rate_limit":
            info.throttled = True
        _walk(sub, info)


def _info(path: str, route: APIRoute) -> RouteInfo:
    info = RouteInfo(
        path=path,
        methods=frozenset(route.methods - {"HEAD", "OPTIONS"}),
        name=route.name,
        module=getattr(route.endpoint, "__module__", ""),
    )
    _walk(route.dependant, info)
    return info


def all_routes() -> list[RouteInfo]:
    out: list[RouteInfo] = []
    for route in app.routes:
        if isinstance(route, APIRoute):
            out.append(_info(route.path, route))
        elif hasattr(route, "original_router"):
            prefix = route.include_context.prefix
            for inner in route.original_router.routes:
                if isinstance(inner, APIRoute):
                    out.append(_info(prefix + inner.path, inner))
    return out
