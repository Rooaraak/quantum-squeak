// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice the two ERC-20 calls the faucet makes
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice what the faucet reads from its game (QuantumCatch)
interface ICatchNight {
    /// @notice the night a net cast at time t goes to (pure: the game's fixed clock)
    function openNightAt(uint256 t) external pure returns (uint32);
}

/// @title Quantum Catch SQK faucet
/// @notice Hands out DRIP of a Sepolia TEST token (Squeekchain test SQK: no money value) so anyone can play Quantum
///         Catch: one claim per address per net night (the owner's rule, 6 Nov: one net's worth per wallet per day).
///         The night is the one a net cast right now would go to, CATCH.openNightAt(block.timestamp): it turns at
///         21:00 UTC, when the nets close. Anyone can refill the faucet with a plain token transfer to this contract.
///         Test tokens only: there is no sybil defence beyond one claim per address per night (a new address can claim
///         too).
/// @dev No owner, no admin, no pause, no proxy, no setters, no withdraw, nothing payable: what is sent here can only
///      ever leave as DRIP to an address that has not claimed for the current net night. When less than DRIP is left,
///      claims revert (FaucetEmpty) until someone refills it. The constructor checks that CATCH answers openNightAt with
///      the Squeek clock (that its nets are paid in TOKEN is checked by the deploy script: ops/sqk-v2-lib.mjs v2Wiring).
contract SqkFaucet {
    /// @notice the token handed out (fixed at deploy)
    IERC20 public immutable TOKEN;
    /// @notice the amount each address can claim once per net night (fixed at deploy)
    uint256 public immutable DRIP;
    /// @notice the game whose net nights the claims follow (fixed at deploy)
    ICatchNight public immutable CATCH;

    /// @dev the net night of each address's last claim + 1 (0 = never claimed), so night 0 works too
    mapping(address => uint256) private _lastPlusOne;

    event Claimed(address indexed to, uint256 amount);

    error TokenHasNoCode(address token);
    error ZeroDrip();
    error CatchHasNoCode(address catch_);
    /// @dev catch_ does not answer openNightAt with the Squeek clock: not a Quantum Catch game
    error NotAGameClock(address catch_);
    error AlreadyClaimedTonight(uint32 night);
    error FaucetEmpty();
    error TransferFailed();

    constructor(IERC20 token, uint256 drip, address catch_) {
        if (address(token).code.length == 0) revert TokenHasNoCode(address(token));
        if (drip == 0) revert ZeroDrip();
        if (catch_.code.length == 0) revert CatchHasNoCode(catch_);
        // the Squeek clock (pure, so any time will do): night 0 starts 12:00 UTC on 1 Jan 1970 (t = 43200) and its nets
        // close 9 h later, when a net goes to night 1
        try ICatchNight(catch_).openNightAt(43200 + 32400) returns (uint32 n) {
            if (n != 1) revert NotAGameClock(catch_);
        } catch {
            revert NotAGameClock(catch_);
        }
        TOKEN = token;
        DRIP = drip;
        CATCH = ICatchNight(catch_);
    }

    /// @notice send DRIP to the caller, once per address per net night (CATCH.openNightAt(now))
    function claim() external {
        uint32 n = CATCH.openNightAt(block.timestamp);
        if (_lastPlusOne[msg.sender] == uint256(n) + 1) revert AlreadyClaimedTonight(n);
        if (TOKEN.balanceOf(address(this)) < DRIP) revert FaucetEmpty();
        _lastPlusOne[msg.sender] = uint256(n) + 1;
        emit Claimed(msg.sender, DRIP);
        if (!TOKEN.transfer(msg.sender, DRIP)) revert TransferFailed();
    }

    /// @notice whether `account` has not claimed yet for the current net night (a claim also needs remaining() >= DRIP)
    function canClaim(address account) external view returns (bool) {
        return _lastPlusOne[account] != uint256(CATCH.openNightAt(block.timestamp)) + 1;
    }

    /// @notice the net night of `account`'s last claim; claimed = false (and night 0) when it never claimed
    function lastClaimNight(address account) external view returns (bool claimed, uint32 night) {
        uint256 v = _lastPlusOne[account];
        if (v == 0) return (false, 0);
        return (true, uint32(v - 1));
    }

    /// @notice what is left to hand out: the faucet's token balance
    function remaining() external view returns (uint256) {
        return TOKEN.balanceOf(address(this));
    }
}
