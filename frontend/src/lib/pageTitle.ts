let claims = 0

export function claimPageTitle(): () => void {
  claims += 1
  let released = false
  return () => {
    if (released) return
    released = true
    claims -= 1
  }
}

export function pageTitleClaimed(): boolean {
  return claims > 0
}
