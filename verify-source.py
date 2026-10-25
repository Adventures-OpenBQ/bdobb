# Copyright 2026 SecretoftheUniverse.com LLC.
# SPDX-License-Identifier: AGPL-3.0-only
import sys
sys.dont_write_bytecode = True
from pathlib import Path
from source_bundle import verify_tree
m = verify_tree(Path(__file__).parent)
print("Verified", m["release"], m["sourceId"])
