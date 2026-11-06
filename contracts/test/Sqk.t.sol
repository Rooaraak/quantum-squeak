// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {CatchBase} from "./Base.t.sol";
import {MockSqk, MockSqkBase, MockSqkNoDomain} from "./mocks/MockSqk.sol";
import {QuantumCatch, IPaintedArt, ISqk} from "../src/QuantumCatch.sol";
import {SqkFaucet, IERC20} from "../src/SqkFaucet.sol";

/// v2: a net costs NET_COST test SQK, burned in the same call (approve + castNet, or castNetWithPermit in one tx)
abstract contract SqkBase is CatchBase {
    uint256 internal constant COST = 1e16; // 0.01 test SQK, the v2 deploy
    uint256 internal constant DRIP = 1e16; // 0.01 test SQK: one net per wallet per net night (amendment 1)
    bytes32 internal constant ERC20_TRANSFER = keccak256("Transfer(address,address,uint256)");

    MockSqk internal sqk;
    uint256 internal alicePk;
    uint256 internal bobPk;

    function setUp() public virtual override {
        sqk = new MockSqk();
        qc = new QuantumCatch(hatcher, NO_ART, ISqk(address(sqk)), COST);
        vm.warp(START_1104 + 3600);
        address a;
        (a, alicePk) = makeAddrAndKey("alice");
        assertEq(a, alice);
        (a, bobPk) = makeAddrAndKey("bob");
        assertEq(a, bob);
        sqk.mint(alice, 1e18);
        sqk.mint(bob, 1e18);
    }

    function _approve(address who, uint256 value) internal {
        vm.prank(who);
        sqk.approve(address(qc), value);
    }

    /// the EIP-2612 digest a wallet signs (eth_signTypedData_v4 of Permit{owner, spender, value, nonce, deadline}
    /// over the token's domain)
    function _digest(MockSqkBase t, address owner, address spender, uint256 value, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        bytes32 h = keccak256(abi.encode(t.PERMIT_TYPEHASH(), owner, spender, value, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", t.DOMAIN_SEPARATOR(), h));
    }

    function _sign(uint256 pk, address owner, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        return vm.sign(pk, _digest(sqk, owner, address(qc), value, sqk.nonces(owner), deadline));
    }
}

contract SqkConstructorTest is SqkBase {
    function test_free_nets_need_cost_zero() public {
        QuantumCatch free = new QuantumCatch(hatcher, NO_ART, NO_SQK, 0);
        assertEq(address(free.SQK()), address(0));
        assertEq(free.NET_COST(), 0);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.BadNetCost.selector, uint256(1)));
        new QuantumCatch(hatcher, NO_ART, NO_SQK, 1);
    }

    function test_paid_nets_need_a_token_with_code_and_a_cost() public {
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.SqkHasNoCode.selector, alice));
        new QuantumCatch(hatcher, NO_ART, ISqk(alice), COST);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.BadNetCost.selector, uint256(0)));
        new QuantumCatch(hatcher, NO_ART, ISqk(address(sqk)), 0);
        assertEq(address(qc.SQK()), address(sqk));
        assertEq(qc.NET_COST(), COST);
        assertEq(qc.name(), "Quantum Catch", "same game, same name");
        assertEq(qc.HATCHER(), hatcher);
    }

    function test_the_free_game_never_calls_a_token() public {
        QuantumCatch free = new QuantumCatch(hatcher, NO_ART, NO_SQK, 0);
        vm.recordLogs();
        vm.prank(alice);
        free.castNet();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 2, "Transfer + NetCast, no NetPaid");
        assertEq(logs[1].topics[0], QuantumCatch.NetCast.selector);
        vm.prank(bob);
        vm.expectRevert(QuantumCatch.FreeNets.selector);
        free.castNetWithPermit(block.timestamp, 27, bytes32(0), bytes32(0));
    }
}

contract SqkCastTest is SqkBase {
    function test_castNet_burns_exactly_the_cost_from_the_caster() public {
        _approve(alice, COST);
        uint256 supply = sqk.totalSupply();
        uint256 want = qc.netId(N1104, alice);
        vm.recordLogs();
        uint256 id = _cast(alice);
        assertEq(id, want);
        assertEq(qc.ownerOf(id), alice);
        assertEq(sqk.balanceOf(alice), 1e18 - COST);
        assertEq(sqk.totalSupply(), supply - COST, "burned, not kept");
        assertEq(sqk.totalBurned(), COST);
        assertEq(sqk.balanceOf(address(qc)), 0, "the game keeps nothing");
        assertEq(sqk.allowance(alice, address(qc)), 0, "the allowance is used up");

        Vm.Log[] memory l = vm.getRecordedLogs();
        assertEq(l.length, 5);
        // the token: caster -> game, game -> burned
        assertEq(l[0].emitter, address(sqk));
        assertEq(l[0].topics[0], ERC20_TRANSFER);
        assertEq(l[0].topics[1], bytes32(uint256(uint160(alice))));
        assertEq(l[0].topics[2], bytes32(uint256(uint160(address(qc)))));
        assertEq(abi.decode(l[0].data, (uint256)), COST);
        assertEq(l[1].emitter, address(sqk));
        assertEq(l[1].topics[1], bytes32(uint256(uint160(address(qc)))));
        assertEq(l[1].topics[2], bytes32(0), "to the zero address: a burn");
        // the game: mint, NetCast exactly as v1, then NetPaid
        assertEq(l[2].emitter, address(qc));
        assertEq(l[2].topics[0], QuantumCatch.Transfer.selector);
        assertEq(l[2].topics[3], bytes32(id));
        assertEq(l[3].emitter, address(qc));
        assertEq(l[3].topics[0], QuantumCatch.NetCast.selector);
        assertEq(l[3].topics[1], bytes32(uint256(N1104)));
        assertEq(l[3].topics[2], bytes32(uint256(uint160(alice))));
        assertEq(l[3].data.length, 32, "NetCast data: the token id only (no spot)");
        assertEq(abi.decode(l[3].data, (uint256)), id);
        assertEq(l[4].emitter, address(qc));
        assertEq(l[4].topics[0], QuantumCatch.NetPaid.selector);
        assertEq(l[4].topics[1], bytes32(uint256(N1104)));
        assertEq(l[4].topics[2], bytes32(uint256(uint160(alice))));
        assertEq(abi.decode(l[4].data, (uint256)), COST);
    }

    function test_NetPaid_event_shape() public {
        _approve(alice, COST);
        vm.expectEmit(true, true, false, true, address(qc));
        emit QuantumCatch.NetCast(N1104, alice, qc.netId(N1104, alice));
        vm.expectEmit(true, true, false, true, address(qc));
        emit QuantumCatch.NetPaid(N1104, alice, COST);
        _cast(alice);
    }

    function test_no_allowance_no_net() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MockSqkBase.ERC20InsufficientAllowance.selector, address(qc), uint256(0), COST)
        );
        qc.castNet();
        _approve(alice, COST - 1);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MockSqkBase.ERC20InsufficientAllowance.selector, address(qc), COST - 1, COST)
        );
        qc.castNet();
        uint256 id = qc.netId(N1104, alice);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, id));
        qc.ownerOf(id);
        assertEq(qc.balanceOf(alice), 0);
        assertEq(sqk.balanceOf(alice), 1e18);
    }

    function test_no_balance_no_net() public {
        address dan = makeAddr("dan");
        sqk.mint(dan, COST - 1);
        _approve(dan, type(uint256).max);
        vm.prank(dan);
        vm.expectRevert(abi.encodeWithSelector(MockSqkBase.ERC20InsufficientBalance.selector, dan, COST - 1, COST));
        qc.castNet();
        assertEq(qc.balanceOf(dan), 0);
        sqk.mint(dan, 1);
        _cast(dan);
        assertEq(sqk.balanceOf(dan), 0);
        assertEq(qc.balanceOf(dan), 1);
    }

    function test_the_old_checks_come_first_and_charge_nothing() public {
        _approve(alice, 10 * COST);
        _cast(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.AlreadyCast.selector, N1104, alice));
        qc.castNet();
        assertEq(sqk.allowance(alice, address(qc)), 9 * COST, "only the one net was paid");
        sqk.mint(hatcher, 1e18);
        _approve(hatcher, COST);
        vm.prank(hatcher);
        vm.expectRevert(QuantumCatch.HatcherIsNotAPlayer.selector);
        qc.castNet();
        assertEq(sqk.balanceOf(hatcher), 1e18);
    }

    function test_a_max_allowance_still_pays_only_the_cost_per_net() public {
        _approve(alice, type(uint256).max);
        _cast(alice);
        vm.warp(qc.nightStart(N1104 + 1) + 60);
        _cast(alice);
        assertEq(sqk.balanceOf(alice), 1e18 - 2 * COST, "two nights, two nets, two costs");
        assertEq(sqk.totalBurned(), 2 * COST);
    }

    function test_no_one_casts_on_someone_elses_allowance() public {
        _approve(alice, type(uint256).max);
        vm.prank(carol); // no SQK, no allowance: alice's allowance is for nets alice casts herself
        vm.expectRevert(
            abi.encodeWithSelector(MockSqkBase.ERC20InsufficientAllowance.selector, address(qc), uint256(0), COST)
        );
        qc.castNet();
        assertEq(sqk.balanceOf(alice), 1e18);
    }

    function test_a_paid_net_resolves_exactly_like_a_free_one() public {
        address who = _casterFor(N1104, 15, _counts1104(), JOB_1104, SHA_1104); // its shot will land on spot 15
        sqk.mint(who, COST);
        _approve(who, COST);
        uint256 id = _cast(who);
        _post1104();
        (uint8 status,, uint8 spot, uint16 hits,, uint8 tier,) = qc.result(id);
        assertEq(status, 1);
        assertEq(spot, 15);
        assertEq(hits, 808);
        assertEq(tier, 1);
        assertGt(bytes(qc.tokenURI(id)).length, 1000);
    }
}

contract SqkPermitTest is SqkBase {
    function test_castNetWithPermit_in_one_transaction() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(alicePk, alice, COST, deadline);
        assertEq(sqk.allowance(alice, address(qc)), 0);
        vm.recordLogs();
        vm.prank(alice);
        uint256 id = qc.castNetWithPermit(deadline, v, r, s);
        assertEq(qc.ownerOf(id), alice);
        assertEq(sqk.nonces(alice), 1, "the permit was used");
        assertEq(sqk.allowance(alice, address(qc)), 0);
        assertEq(sqk.balanceOf(alice), 1e18 - COST);
        assertEq(sqk.totalBurned(), COST);
        assertEq(sqk.balanceOf(address(qc)), 0);
        Vm.Log[] memory l = vm.getRecordedLogs();
        assertEq(l.length, 6, "Approval, 2 token Transfers, Transfer, NetCast, NetPaid");
        assertEq(l[0].topics[0], keccak256("Approval(address,address,uint256)"));
        assertEq(l[4].topics[0], QuantumCatch.NetCast.selector);
        assertEq(l[5].topics[0], QuantumCatch.NetPaid.selector);
    }

    function test_a_front_run_permit_still_casts() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(alicePk, alice, COST, deadline);
        vm.prank(carol); // someone copies the signature from the mempool and submits the permit first
        sqk.permit(alice, address(qc), COST, deadline, v, r, s);
        assertEq(sqk.allowance(alice, address(qc)), COST);
        vm.prank(alice);
        uint256 id = qc.castNetWithPermit(deadline, v, r, s); // the permit itself now fails: ignored
        assertEq(qc.ownerOf(id), alice);
        assertEq(sqk.balanceOf(alice), 1e18 - COST);
        assertEq(sqk.nonces(alice), 1);
    }

    function test_a_bad_permit_with_an_allowance_casts() public {
        _approve(alice, COST);
        vm.prank(alice);
        uint256 id = qc.castNetWithPermit(block.timestamp + 1, 27, bytes32(uint256(1)), bytes32(uint256(2)));
        assertEq(qc.ownerOf(id), alice);
        assertEq(sqk.nonces(alice), 0, "the bad permit changed nothing");
    }

    function test_a_bad_or_late_permit_without_an_allowance_reverts() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(alicePk, alice, COST, deadline);
        bytes memory noAllowance =
            abi.encodeWithSelector(MockSqkBase.ERC20InsufficientAllowance.selector, address(qc), uint256(0), COST);
        vm.prank(alice);
        vm.expectRevert(noAllowance);
        qc.castNetWithPermit(deadline, v, r, bytes32(uint256(s) ^ 1)); // tampered
        (v, r, s) = _sign(alicePk, alice, COST - 1, deadline); // for less than the cost: the digest differs
        vm.prank(alice);
        vm.expectRevert(noAllowance);
        qc.castNetWithPermit(deadline, v, r, s);
        (v, r, s) = _sign(alicePk, alice, COST, block.timestamp - 1); // expired
        vm.prank(alice);
        vm.expectRevert(noAllowance);
        qc.castNetWithPermit(block.timestamp - 1, v, r, s);
        (v, r, s) = _sign(bobPk, alice, COST, deadline); // bob signs for alice
        vm.prank(alice);
        vm.expectRevert(noAllowance);
        qc.castNetWithPermit(deadline, v, r, s);
        assertEq(qc.balanceOf(alice), 0);
        assertEq(sqk.balanceOf(alice), 1e18);
    }

    function test_someone_else_cannot_spend_alices_permit() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(alicePk, alice, COST, deadline);
        // bob submits alice's signature: the permit is checked for owner = bob, fails, and bob has no allowance
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(MockSqkBase.ERC20InsufficientAllowance.selector, address(qc), uint256(0), COST)
        );
        qc.castNetWithPermit(deadline, v, r, s);
        assertEq(sqk.nonces(alice), 0, "alice's signature is still unused");
        vm.prank(alice);
        qc.castNetWithPermit(deadline, v, r, s);
        assertEq(sqk.balanceOf(bob), 1e18);
        assertEq(sqk.balanceOf(alice), 1e18 - COST);
    }

    function test_the_permit_checks_still_come_first() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(alicePk, alice, COST, deadline);
        vm.prank(alice);
        qc.castNetWithPermit(deadline, v, r, s);
        assertEq(sqk.nonces(alice), 1);
        (v, r, s) = _sign(alicePk, alice, COST, deadline);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.AlreadyCast.selector, N1104, alice));
        qc.castNetWithPermit(deadline, v, r, s);
        assertEq(sqk.nonces(alice), 1, "reverted as a whole: the second permit was not used");
        assertEq(sqk.allowance(alice, address(qc)), 0);
        // the hatcher is not a player, even with SQK and a permit
        (address h, uint256 hPk) = makeAddrAndKey("hatcher-with-a-key");
        QuantumCatch q2 = new QuantumCatch(h, NO_ART, ISqk(address(sqk)), COST);
        sqk.mint(h, COST);
        bytes32 digest = _digest(sqk, h, address(q2), COST, 0, deadline);
        (v, r, s) = vm.sign(hPk, digest);
        vm.prank(h);
        vm.expectRevert(QuantumCatch.HatcherIsNotAPlayer.selector);
        q2.castNetWithPermit(deadline, v, r, s);
        assertEq(sqk.nonces(h), 0);
    }

    function test_castNetWithPermit_is_not_payable() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(qc).call{value: 1}(
            abi.encodeCall(QuantumCatch.castNetWithPermit, (block.timestamp, 27, bytes32(0), bytes32(0)))
        );
        assertFalse(ok);
    }

    /// what the page signs: the domain read from eip712Domain() (EIP-5267) when the token has it, else name() +
    /// version "1" + chainId + the token address; both give the token's DOMAIN_SEPARATOR
    function test_typed_data_domain_both_ways() public {
        (
            bytes1 fields,
            string memory n,
            string memory ver,
            uint256 chainId,
            address vc,
            bytes32 salt,
            uint256[] memory ext
        ) = sqk.eip712Domain();
        assertEq(uint8(fields), 0x0f);
        assertEq(n, "Squeek");
        assertEq(ver, "1");
        assertEq(chainId, block.chainid);
        assertEq(vc, address(sqk));
        assertEq(salt, bytes32(0));
        assertEq(ext.length, 0);
        assertEq(_separator(n, ver, chainId, vc), sqk.DOMAIN_SEPARATOR());

        MockSqkNoDomain legacy = new MockSqkNoDomain();
        (bool ok,) = address(legacy).staticcall(abi.encodeWithSignature("eip712Domain()"));
        assertFalse(ok, "no eip712Domain()");
        assertEq(_separator(legacy.name(), "1", block.chainid, address(legacy)), legacy.DOMAIN_SEPARATOR());

        // and a castNetWithPermit through the legacy token works the same
        QuantumCatch q2 = new QuantumCatch(hatcher, NO_ART, ISqk(address(legacy)), COST);
        legacy.mint(alice, COST);
        uint256 deadline = block.timestamp + 60;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, _digest(legacy, alice, address(q2), COST, 0, deadline));
        vm.prank(alice);
        q2.castNetWithPermit(deadline, v, r, s);
        assertEq(legacy.balanceOf(alice), 0);
        assertEq(legacy.totalSupply(), 0);
    }

    function _separator(string memory n, string memory ver, uint256 chainId, address vc)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(n)),
                keccak256(bytes(ver)),
                chainId,
                vc
            )
        );
    }
}

/// a token whose transferFrom says false instead of reverting
contract FalseSqk is MockSqk {
    function transferFrom(address, address, uint256) external pure override returns (bool) {
        return false;
    }
}

/// a token that, while the game pulls the cost, looks at the game's state and tries to re-enter it
contract PeekSqk is MockSqk {
    QuantumCatch public game;
    address public seenOwner;
    uint256 public seenBalance;
    bool public reentered;
    bool internal _armed;

    function arm(QuantumCatch g) external {
        game = g;
        _armed = true;
    }

    function transferFrom(address from, address to, uint256 value) external override returns (bool) {
        if (_armed) {
            _armed = false;
            seenOwner = game.ownerOf(game.netId(game.openNight(), from));
            seenBalance = game.balanceOf(from);
            // re-enter: cast a net for the token itself (it pays itself nothing: it has no allowance) - must fail
            try game.castNet() {
                reentered = true;
            } catch {}
        }
        _spendAllowance(from, msg.sender, value);
        _transfer(from, to, value);
        return true;
    }
}

contract SqkHostileTokenTest is SqkBase {
    function test_a_token_that_returns_false_casts_nothing() public {
        FalseSqk f = new FalseSqk();
        QuantumCatch q2 = new QuantumCatch(hatcher, NO_ART, ISqk(address(f)), COST);
        vm.prank(alice);
        vm.expectRevert(QuantumCatch.SqkTransferFailed.selector);
        q2.castNet();
        assertEq(q2.balanceOf(alice), 0);
    }

    function test_the_net_is_recorded_before_the_token_runs() public {
        PeekSqk p = new PeekSqk();
        QuantumCatch q2 = new QuantumCatch(hatcher, NO_ART, ISqk(address(p)), COST);
        p.mint(alice, COST);
        vm.prank(alice);
        p.approve(address(q2), COST);
        p.arm(q2);
        vm.prank(alice);
        uint256 id = q2.castNet();
        assertEq(p.seenOwner(), alice, "checks-effects-interactions: the net existed when the token was called");
        assertEq(p.seenBalance(), 1);
        assertFalse(p.reentered(), "a re-entered cast without payment failed");
        assertEq(q2.ownerOf(id), alice);
        assertEq(q2.balanceOf(address(p)), 0);
        assertEq(p.balanceOf(alice), 0);
        assertEq(p.totalSupply(), 0);
    }
}

/// the faucet (amendment 1): one DRIP (= one net, 0.01 test SQK) per address per NET NIGHT, the night a net cast now
/// goes to (CATCH.openNightAt): it turns at 21:00 UTC, when the nets close
contract SqkFaucetTest is SqkBase {
    SqkFaucet internal faucet;

    function setUp() public override {
        super.setUp();
        faucet = new SqkFaucet(IERC20(address(sqk)), DRIP, address(qc));
        sqk.mint(address(this), 1e18);
        sqk.transfer(address(faucet), 3 * DRIP); // a refill is a plain transfer
    }

    function _last(address a) internal view returns (bool claimed, uint32 night) {
        return faucet.lastClaimNight(a);
    }

    function test_constructor() public {
        assertEq(address(faucet.TOKEN()), address(sqk));
        assertEq(faucet.DRIP(), DRIP);
        assertEq(faucet.DRIP(), qc.NET_COST(), "one claim = one net");
        assertEq(address(faucet.CATCH()), address(qc));
        vm.expectRevert(abi.encodeWithSelector(SqkFaucet.TokenHasNoCode.selector, alice));
        new SqkFaucet(IERC20(alice), DRIP, address(qc));
        vm.expectRevert(SqkFaucet.ZeroDrip.selector);
        new SqkFaucet(IERC20(address(sqk)), 0, address(qc));
        vm.expectRevert(abi.encodeWithSelector(SqkFaucet.CatchHasNoCode.selector, alice));
        new SqkFaucet(IERC20(address(sqk)), DRIP, alice);
        // a contract that is not a game clock (here the token itself): no openNightAt
        vm.expectRevert(abi.encodeWithSelector(SqkFaucet.NotAGameClock.selector, address(sqk)));
        new SqkFaucet(IERC20(address(sqk)), DRIP, address(sqk));
    }

    function test_claim_once_per_address_per_net_night() public {
        address dan = makeAddr("dan");
        assertTrue(faucet.canClaim(dan));
        (bool ever, uint32 night) = _last(dan);
        assertFalse(ever);
        assertEq(night, 0);
        assertEq(faucet.remaining(), 3 * DRIP);
        vm.expectEmit(true, false, false, true, address(faucet));
        emit SqkFaucet.Claimed(dan, DRIP);
        vm.prank(dan);
        faucet.claim();
        assertFalse(faucet.canClaim(dan));
        (ever, night) = _last(dan);
        assertTrue(ever);
        assertEq(night, N1104);
        assertEq(sqk.balanceOf(dan), DRIP);
        assertEq(faucet.remaining(), 2 * DRIP);
        bytes memory tonight = abi.encodeWithSelector(SqkFaucet.AlreadyClaimedTonight.selector, N1104);
        vm.prank(dan);
        vm.expectRevert(tonight);
        faucet.claim();
        sqk.transfer(address(faucet), 5 * DRIP);
        vm.prank(dan);
        vm.expectRevert(tonight);
        faucet.claim(); // a refill does not reset it
        vm.warp(LOCK_1104 - 1); // 20:59:59 UTC: still tonight's net night
        vm.prank(dan);
        vm.expectRevert(tonight);
        faucet.claim();
        vm.warp(LOCK_1104); // 21:00 UTC: the nets close, a net cast now goes to the next night: a new claim
        assertTrue(faucet.canClaim(dan));
        vm.prank(dan);
        faucet.claim();
        (, night) = _last(dan);
        assertEq(night, N1104 + 1);
        assertEq(sqk.balanceOf(dan), 2 * DRIP);
        vm.warp(OVER_1104 - 1); // the next morning: still the same net night (N1104 + 1)
        vm.prank(dan);
        vm.expectRevert(abi.encodeWithSelector(SqkFaucet.AlreadyClaimedTonight.selector, N1104 + 1));
        faucet.claim();
    }

    /// the +1 offset: a claim in net night 0 counts too
    function test_night_zero_counts() public {
        vm.warp(43200 + 60); // 1 Jan 1970 12:01 UTC: net night 0
        assertEq(qc.openNight(), 0);
        vm.prank(alice);
        faucet.claim();
        (bool ever, uint32 night) = _last(alice);
        assertTrue(ever);
        assertEq(night, 0);
        assertFalse(faucet.canClaim(alice));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SqkFaucet.AlreadyClaimedTonight.selector, uint32(0)));
        faucet.claim();
    }

    function test_empty_until_refilled() public {
        for (uint256 i; i < 3; ++i) {
            vm.prank(makeAddr(string.concat("p", vm.toString(i))));
            faucet.claim();
        }
        assertEq(faucet.remaining(), 0);
        address late = makeAddr("late");
        vm.prank(late);
        vm.expectRevert(SqkFaucet.FaucetEmpty.selector);
        faucet.claim();
        sqk.transfer(address(faucet), DRIP - 1); // less than one drip: still empty
        vm.prank(late);
        vm.expectRevert(SqkFaucet.FaucetEmpty.selector);
        faucet.claim();
        assertTrue(faucet.canClaim(late), "a failed claim is not a claim");
        (bool ever,) = _last(late);
        assertFalse(ever);
        sqk.transfer(address(faucet), 1);
        vm.prank(late);
        faucet.claim();
        assertEq(sqk.balanceOf(late), DRIP);
        assertEq(faucet.remaining(), 0);
    }

    /// a fresh wallet plays every night on the faucet alone: claim, cast with a permit, nothing left over
    function test_claim_then_play_one_net_every_night() public {
        (address eve, uint256 evePk) = makeAddrAndKey("eve");
        sqk.transfer(address(faucet), 3 * DRIP);
        uint256 supply = sqk.totalSupply();
        for (uint256 i; i < 5; ++i) {
            vm.warp(qc.nightStart(N1104 + uint32(i)) + 60);
            vm.prank(eve);
            faucet.claim();
            uint256 deadline = block.timestamp + 600;
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(evePk, _digest(sqk, eve, address(qc), COST, i, deadline));
            vm.prank(eve);
            qc.castNetWithPermit(deadline, v, r, s);
            assertEq(sqk.balanceOf(eve), 0, "one drip = one net");
        }
        assertEq(qc.balanceOf(eve), 5);
        assertEq(sqk.totalSupply(), supply - 5 * DRIP);
        vm.prank(eve);
        vm.expectRevert(abi.encodeWithSelector(SqkFaucet.AlreadyClaimedTonight.selector, N1104 + 4));
        faucet.claim(); // no second drip the same night
    }

    function test_a_token_that_returns_false_pays_nothing() public {
        FalseTransferSqk f = new FalseTransferSqk();
        QuantumCatch q2 = new QuantumCatch(hatcher, NO_ART, ISqk(address(f)), COST);
        SqkFaucet f2 = new SqkFaucet(IERC20(address(f)), DRIP, address(q2));
        f.mint(address(f2), DRIP);
        vm.prank(alice);
        vm.expectRevert(SqkFaucet.TransferFailed.selector);
        f2.claim();
        assertTrue(f2.canClaim(alice), "the failed claim was undone");
    }
}

contract FalseTransferSqk is MockSqk {
    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }
}

/// any balance, any allowance: a net is cast iff both cover the cost, and then exactly the cost is burned
contract SqkFuzzTest is SqkBase {
    function testFuzz_cast_iff_balance_and_allowance_cover_the_cost(uint256 bal, uint256 allow) public {
        bal = bound(bal, 0, 3 * COST);
        allow = bound(allow, 0, 3 * COST);
        address p = makeAddr("fuzz");
        sqk.mint(p, bal);
        _approve(p, allow);
        uint256 supply = sqk.totalSupply();
        vm.prank(p);
        try qc.castNet() returns (uint256 id) {
            assertTrue(bal >= COST && allow >= COST, "cast only when paid");
            assertEq(qc.ownerOf(id), p);
            assertEq(sqk.balanceOf(p), bal - COST);
            assertEq(sqk.allowance(p, address(qc)), allow - COST);
            assertEq(sqk.totalSupply(), supply - COST);
        } catch {
            assertFalse(bal >= COST && allow >= COST, "paid but not cast");
            assertEq(qc.balanceOf(p), 0);
            assertEq(sqk.balanceOf(p), bal);
            assertEq(sqk.totalSupply(), supply);
        }
        assertEq(sqk.balanceOf(address(qc)), 0);
    }

    function testFuzz_permit_any_deadline(uint256 deadline) public {
        deadline = bound(deadline, block.timestamp - 1 days, block.timestamp + 365 days);
        (uint8 v, bytes32 r, bytes32 s) = _sign(alicePk, alice, COST, deadline);
        vm.prank(alice);
        try qc.castNetWithPermit(deadline, v, r, s) {
            assertGe(deadline, block.timestamp, "only a live permit casts (no other allowance)");
            assertEq(sqk.balanceOf(alice), 1e18 - COST);
        } catch {
            assertLt(deadline, block.timestamp);
            assertEq(sqk.balanceOf(alice), 1e18);
        }
    }
}
