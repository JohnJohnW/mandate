// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title MandateMath
/// @notice Fixed-window spend accounting shared by MandateVault and its tests.
/// @dev The off-chain policy engine mirrors this function exactly; the fixture
///      in packages/core/fixtures/window.json pins both implementations.
library MandateMath {
    /// @notice Returns the window state after rolling it forward to `timestamp`.
    /// @dev When the window has elapsed it restarts at `timestamp` with zero spent.
    function roll(
        uint128 spentInWindow,
        uint64 windowStart,
        uint32 windowSeconds,
        uint256 timestamp
    ) internal pure returns (uint128 spent, uint64 start) {
        if (timestamp >= uint256(windowStart) + uint256(windowSeconds)) {
            // casting to uint64 is safe: block timestamps fit in 64 bits for the foreseeable future
            // forge-lint: disable-next-line(unsafe-typecast)
            return (0, uint64(timestamp));
        }
        return (spentInWindow, windowStart);
    }
}
