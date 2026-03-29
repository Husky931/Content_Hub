# P1 Issues — Blocked / Needs Input

| Issue | Title | Question |
|-------|-------|----------|
| #40 | Health API should return 200 w/o auth | Code already exempts `/api/health` from auth in middleware.ts `publicRoutes`. Need to confirm: is a reverse proxy or load balancer adding auth in front? What exact error/status do you see when hitting the endpoint? |
