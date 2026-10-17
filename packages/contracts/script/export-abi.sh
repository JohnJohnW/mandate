#!/bin/sh
# Writes the compiled ABIs into ts/abi so TypeScript packages can import them without forge.
set -e
cd "$(dirname "$0")/.."
forge build >/dev/null
mkdir -p ts/abi
for c in MandateVault MockERC20 MockWETH; do
  forge inspect "$c" abi --json > "ts/abi/$c.json"
done
echo "ABIs exported to ts/abi"
