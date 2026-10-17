#!/bin/sh
# Installs the Solidity dependencies into lib/ (lib/ is not tracked in git).
set -e
cd "$(dirname "$0")"
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts@v5.4.0 --no-git
echo "contracts dependencies installed"
