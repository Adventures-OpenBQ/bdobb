# Reproduce the packaged screener table check

The opt-in Chromium check verifies `price_change_5d` through the actual BDOBB table. Docker's generated widget and HTTP response row come from the same local image. The upstream fixture reports 5 percentage points, the packaged row stores 0.05, and the table must display **5 %**. The SDK fixture uses fictional data and the extraction runs with networking disabled. [Recorded table capture](../screenshots/paired-formatted-table.png)

## Extract one fixture and run the case

Run the block from the BDOBB root with its normal Playwright dependencies and Chromium installed. Replace `/path/to/openbq-docker` with the local Docker checkout. The fixed image must already be built locally. Its build command appears in the [verification record](../verification.md#docker-image-and-source-pin). The test imports `./fixtures` and reads `./paired-table-cell.json`. The temporary copy and JSON therefore sit beside `e2e/fixtures.ts` for the run.

```bash
(
  set -euo pipefail
  docker_repo=/path/to/openbq-docker
  docker_commit=0e843db5465725f124075709528ea485618c87ad
  image=sha256:44976f3671e5642c30808316d147e40bd841404455bad9c29aa1dbbd8f18d74b
  spec=e2e/paired-table-cell.spec.ts
  fixture=e2e/paired-table-cell.json
  test ! -e "$spec"
  test ! -L "$spec"
  test ! -e "$fixture"
  test ! -L "$fixture"
  work=$(mktemp -d)
  trap 'rm -f "$spec" "$fixture"' EXIT

  git -C "$docker_repo" archive "$docker_commit" v9/eodhd | tar -x -C "$work"
  docker run --rm -i --network none -v "$work/v9/eodhd:/check:ro" "$image" \
    python - > "$fixture" <<'PY'
import json
import sys
from contextlib import redirect_stdout

sys.path.insert(0, "/check/tests")
with redirect_stdout(sys.stderr):
    from test_stack import ChartSource, MirrorNamespace

    MirrorNamespace.setUpClass()
    ChartSource.setUpClass()

widget_id = "eodhd_equity_screener_eodhd_obb"
status, body = ChartSource.responses["screener"]
assert status == 200, status
print(json.dumps({"widget": MirrorNamespace.widgets[widget_id], "row": body["results"][0]}))
PY

  cp docs/releases/validation/v9/screening-income/reproduce/paired-table-cell.spec.ts.example "$spec"
  pnpm exec playwright test "$spec" --project=chromium --reporter=list \
    --output "$work/playwright-results"
  printf 'Capture and run artifacts: %s\n' "$work"
)
```

Playwright starts or reuses the normal browser fixture server. The temporary spec and JSON are removed on exit. The case lives under this documentation directory and is run only by the explicit copy and invocation above.

For the failing comparison, rerun with Docker commit `fb2df569e30c618652a9eec00db95c7ec7d4ad86` and the earlier local image `sha256:7a56d854c1f1e189e154e8902a45d2ba850c12df0693b9a8e5e447f609c89df7`. Keep the same **5 %** assertion. The earlier widget selects the percentage-point formatter and the Chromium cell displays **0.05 %**. [Original finding](../original-review.md#important)
