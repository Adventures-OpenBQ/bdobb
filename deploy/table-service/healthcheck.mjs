// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
try {
  const config=JSON.parse(readFileSync(process.env.TABLE_SERVICE_CONFIG,"utf8"));
  const port=config.listen.split(":").at(-1);
  const response=await fetch(`http://127.0.0.1:${port}/healthz`,{headers:{
    "X-Table-Gateway-Token":config.auth.gateway_token,"X-Table-Principal":"healthcheck"},signal:AbortSignal.timeout(3000)});
  if(!response.ok || (await response.json()).status!=="ok")process.exit(1);
}catch{process.exit(1);}
