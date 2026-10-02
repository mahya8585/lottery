# Lottery API

The API runs in the same Node.js process that serves the frontend.

## Required settings

- `ADMIN_KEY`: Administrator password. It is sent only once in the JSON body of
  `POST /api/admin/login` and is never accepted in the URL.
- `CODE_PEPPER`: Secret used to HMAC participant codes before storing them.
- `DATA_FILE`: State file path. The deployment defaults to `/home/data/lottery-state.json`.

`ADMIN_KEY` and `CODE_PEPPER` must be configured as App Service settings and must
not be committed to the repository.

## CSV formats

Participants:

```csv
code,name
CODE-0001,Participant 1
CODE-0002,Participant 2
```

Prizes:

```csv
prizeName,quantity
First Prize,1
Second Prize,3
```

The prize total must not exceed the participant count.

Sample files are available in:

- `samples/participants.csv`
- `samples/prizes.csv`

The `samples/` directory is outside the deployment source allowlist. The
packaging script copies only `site/` and `app/server.js`, and fails if a CSV file
is found in the generated deployment package.

## Endpoints

- `GET /health`
- `POST /api/draw` with JSON `{ "participantCode": "CODE-0001" }`
- `POST /api/admin/login` with JSON `{ "password": "..." }`
- `POST /api/admin/logout`
- `GET /api/admin/stats`
- `POST /api/admin/participants/import` with a CSV body
- `POST /api/admin/prizes/import` with a CSV body
- `POST /api/admin/reset`
- `POST /api/admin/close`
- `GET /api/admin/export`

## Administrator authentication

`POST /api/admin/login` verifies the password and issues a random session token in
the `lottery_admin_session` cookie (`Path=/api/admin; HttpOnly; Secure;
SameSite=Strict`). The session expires after 30 minutes. All other
`/api/admin/*` endpoints require this cookie and return `401` otherwise. Sessions
are held in process memory, so they are cleared when the app restarts.

The local JSON file is suitable only for the selected single-instance F1
configuration. It can be lost during platform or storage failures and must not be
used with multiple App Service instances.
