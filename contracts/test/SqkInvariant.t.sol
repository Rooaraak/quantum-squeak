// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {QuantumCatch, IPaintedArt, ISqk} from "../src/QuantumCatch.sol";
import {SqkFaucet, IERC20} from "../src/SqkFaucet.sol";
import {MockSqk} from "./mocks/MockSqk.sol";

/// random players claim from the faucet (once per net night), approve any amount, cast with or without a permit (good,
/// stale or bad), move SQK around, refill the faucet, send SQK to the game by mistake, and time passes
contract SqkHandler is Test {
    QuantumCatch public qc;
    MockSqk public sqk;
    SqkFaucet public faucet;
    uint256 public constant COST = 1e16;
    uint256 public constant DRIP = 1e16;

    uint256[4] internal pks;
    address[4] public players;
    uint256 public nets; // nets cast
    uint256 public claims; // faucet claims
    uint256 public refilled; // SQK sent to the faucet (besides the start)
    uint256 public misSent; // SQK sent to the game by plain transfer (stays there: no withdraw)
    mapping(address => uint256) public paid; // SQK each player paid for nets
    mapping(address => uint256) public ghostNightPlusOne; // the net night of each player's last claim + 1
    uint256 public doubleClaims; // a second claim in the same net night that went through (must stay 0)

    constructor(QuantumCatch qc_, MockSqk sqk_, SqkFaucet faucet_) {
        qc = qc_;
        sqk = sqk_;
        faucet = faucet_;
        for (uint256 i; i < 4; ++i) {
            (players[i], pks[i]) = makeAddrAndKey(string.concat("player", vm.toString(i)));
        }
    }

    function _p(uint256 seed) internal pure returns (uint256) {
        return seed % 4;
    }

    function claim(uint256 who) external {
        address p = players[_p(who)];
        uint256 n1 = uint256(qc.openNight()) + 1;
        vm.prank(p);
        try faucet.claim() {
            ++claims;
            if (ghostNightPlusOne[p] == n1) ++doubleClaims;
            ghostNightPlusOne[p] = n1;
        } catch {}
    }

    function approve(uint256 who, uint256 amount) external {
        amount = bound(amount, 0, 5 * COST); // (bound logs: work it out before the prank)
        vm.prank(players[_p(who)]);
        sqk.approve(address(qc), amount);
    }

    function cast(uint256 who) external {
        address p = players[_p(who)];
        vm.prank(p);
        try qc.castNet() {
            ++nets;
            paid[p] += COST;
        } catch {}
    }

    function castWithPermit(uint256 who, uint256 mode) external {
        uint256 i = _p(who);
        address p = players[i];
        uint256 deadline = block.timestamp + 600;
        uint256 nonce = sqk.nonces(p);
        mode = mode % 3; // 0 good, 1 stale nonce (as after a front-run), 2 signed by someone else
        if (mode == 1 && nonce > 0) nonce -= 1;
        uint256 pk = mode == 2 ? pks[(i + 1) % 4] : pks[i];
        bytes32 h = keccak256(abi.encode(sqk.PERMIT_TYPEHASH(), p, address(qc), COST, nonce, deadline));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", sqk.DOMAIN_SEPARATOR(), h)));
        vm.prank(p);
        try qc.castNetWithPermit(deadline, v, r, s) {
            ++nets;
            paid[p] += COST;
        } catch {}
    }

    /// the page's usual night: claim the faucet's drip, sign a permit, cast in one transaction
    function claimAndCast(uint256 who) external {
        uint256 i = _p(who);
        address p = players[i];
        uint256 n1 = uint256(qc.openNight()) + 1;
        vm.prank(p);
        try faucet.claim() {
            ++claims;
            if (ghostNightPlusOne[p] == n1) ++doubleClaims;
            ghostNightPlusOne[p] = n1;
        } catch {}
        uint256 deadline = block.timestamp + 600;
        bytes32 h = keccak256(abi.encode(sqk.PERMIT_TYPEHASH(), p, address(qc), COST, sqk.nonces(p), deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pks[i], keccak256(abi.encodePacked("\x19\x01", sqk.DOMAIN_SEPARATOR(), h)));
        vm.prank(p);
        try qc.castNetWithPermit(deadline, v, r, s) {
            ++nets;
            paid[p] += COST;
        } catch {}
    }

    function give(uint256 from, uint256 to, uint256 amount) external {
        address a = players[_p(from)];
        amount = bound(amount, 0, sqk.balanceOf(a));
        vm.prank(a);
        sqk.transfer(players[_p(to)], amount);
    }

    function refill(uint256 amount) external {
        amount = bound(amount, 0, 3e17);
        sqk.mint(address(faucet), amount);
        refilled += amount;
    }

    function sendToGame(uint256 who, uint256 amount) external {
        address a = players[_p(who)];
        amount = bound(amount, 0, sqk.balanceOf(a) / 10);
        vm.prank(a);
        sqk.transfer(address(qc), amount);
        misSent += amount;
    }

    function wait(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }
}

contract SqkInvariantTest is Test {
    QuantumCatch internal qc;
    MockSqk internal sqk;
    SqkFaucet internal faucet;
    SqkHandler internal h;
    uint256 internal constant START = 5e17;

    function setUp() public {
        vm.warp(1793793600 + 3600);
        sqk = new MockSqk();
        qc = new QuantumCatch(address(0x4A7C4E5), IPaintedArt(address(0)), ISqk(address(sqk)), 1e16);
        faucet = new SqkFaucet(IERC20(address(sqk)), 1e16, address(qc));
        sqk.mint(address(faucet), START);
        h = new SqkHandler(qc, sqk, faucet);
        targetContract(address(h));
    }

    /// how much each run did (forge test -vv shows it): the invariants are only worth something if nets were cast
    function afterInvariant() public view {
        console2.log("nets", h.nets(), "claims", h.claims());
    }

    function invariant_every_net_burned_exactly_its_cost() public view {
        assertEq(sqk.totalBurned(), h.nets() * 1e16, "burned = nets x cost");
        assertEq(sqk.totalSupply(), START + h.refilled() - h.nets() * 1e16, "nothing else minted or burned");
        uint256 held;
        for (uint256 i; i < 4; ++i) {
            held += qc.balanceOf(h.players(i));
        }
        assertEq(held, h.nets(), "every paid net exists, every net was paid");
    }

    function invariant_the_game_keeps_nothing_it_was_paid() public view {
        assertEq(sqk.balanceOf(address(qc)), h.misSent(), "only SQK sent to it by mistake, never a net's cost");
    }

    function invariant_the_faucet_only_drips() public view {
        assertEq(faucet.remaining(), START + h.refilled() - h.claims() * 1e16);
        assertEq(h.doubleClaims(), 0, "one claim per address per net night");
        uint256 n1 = uint256(qc.openNight()) + 1;
        for (uint256 i; i < 4; ++i) {
            address p = h.players(i);
            assertEq(faucet.canClaim(p), h.ghostNightPlusOne(p) != n1, "canClaim = not claimed this net night");
            (bool ever, uint32 night) = faucet.lastClaimNight(p);
            assertEq(ever, h.ghostNightPlusOne(p) != 0);
            if (ever) assertEq(uint256(night) + 1, h.ghostNightPlusOne(p));
        }
    }

    function invariant_players_hold_what_they_got_minus_what_they_paid() public view {
        uint256 total;
        uint256 spent;
        for (uint256 i; i < 4; ++i) {
            address p = h.players(i);
            total += sqk.balanceOf(p);
            spent += h.paid(p);
        }
        assertEq(total + spent + h.misSent(), h.claims() * 1e16, "players' SQK = drips - nets paid - sent to the game");
    }
}
