# Lottery API

The API runs in the same Node.js process that serves the frontend.

## Required settings

- `ADMIN_KEY`: Administrator password used by the existing `adminKey` query parameter.
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
- `GET /api/admin/stats?adminKey=...`
- `POST /api/admin/participants/import?adminKey=...` with a CSV body
- `POST /api/admin/prizes/import?adminKey=...` with a CSV body
- `POST /api/admin/reset?adminKey=...`
- `POST /api/admin/close?adminKey=...`
- `GET /api/admin/export?adminKey=...`

The local JSON file is suitable only for the selected single-instance F1
configuration. It can be lost during platform or storage failures and must not be
used with multiple App Service instances.
