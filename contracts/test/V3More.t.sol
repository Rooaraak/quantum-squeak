// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {V3Base, MockRenderer} from "./V3Base.t.sol";
import {S2ArtBase} from "./S2Render.t.sol";
import {MockSqk, MockSqkBase} from "./mocks/MockSqk.sol";
import {QuantumCatchV3, ISqk} from "../src/QuantumCatchV3.sol";
import {SqkFaucet, IERC20} from "../src/SqkFaucet.sol";
import {Card, Dna, IS2Renderer} from "../src/S2Types.sol";

/// Season 2 nets cost test SQK exactly as Season 1's (v2's code path), and v2's faucet serves v3
contract V3SqkTest is V3Base {
    uint256 internal constant COST = 1e16;
    MockSqk internal sqk;
    uint256 internal alicePk;

    function setUp() public override {
        super.setUp();
        sqk = new MockSqk();
        qc = new QuantumCatchV3(hatcher, mock, ISqk(address(sqk)), COST);
        address a;
        (a, alicePk) = makeAddrAndKey("alice");
        assertEq(a, alice);
        sqk.mint(alice, 1e18);
    }

    function _digest(address owner, uint256 value, uint256 deadline) internal view returns (bytes32) {
        bytes32 h = keccak256(
            abi.encode(sqk.PERMIT_TYPEHASH(), owner, address(qc), value, sqk.nonces(owner), deadline)
        );
        return keccak256(abi.encodePacked("\x19\x01", sqk.DOMAIN_SEPARATOR(), h));
    }

    function test_cast_burns_exactly_the_cost() public {
        vm.prank(alice);
        sqk.approve(address(qc), COST);
        uint256 supply = sqk.totalSupply();
        _cast(alice);
        assertEq(sqk.balanceOf(alice), 1e18 - COST);
        assertEq(sqk.balanceOf(address(qc)), 0, "the game keeps nothing");
        assertEq(sqk.totalSupply(), supply - COST, "burned");
    }

    function test_permit_cast() public {
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, _digest(alice, COST, deadline));
        vm.prank(alice);
        uint256 id = qc.castNetWithPermit(deadline, v, r, s);
        assertEq(qc.ownerOf(id), alice);
        assertEq(sqk.balanceOf(alice), 1e18 - COST);
        assertEq(sqk.allowance(alice, address(qc)), 0);
    }

    function test_no_allowance_no_net() public {
        vm.prank(alice);
        vm.expectRevert();
        qc.castNet();
    }

    function test_v2s_faucet_follows_v3s_nights() public {
        SqkFaucet f = new SqkFaucet(IERC20(address(sqk)), COST, address(qc));
        sqk.mint(address(f), 1e18);
        vm.prank(bob);
        f.claim();
        assertEq(sqk.balanceOf(bob), COST);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(SqkFaucet.AlreadyClaimedTonight.selector, N1104));
        f.claim();
        vm.warp(qc.netsCloseAt(N1104)); // 21:00 UTC: the net night turns
        vm.prank(bob);
        f.claim();
        assertEq(sqk.balanceOf(bob), 2 * COST);
        // and the claimed SQK casts a v3 net for that night
        vm.prank(bob);
        sqk.approve(address(qc), COST);
        uint256 id = _cast(bob);
        assertEq(id >> 160, N1104 + 1);
    }
}

/// nothing in Season 2 takes ETH, and nobody but the owner (until lock) can change anything
contract V3HonestyTest is S2ArtBase {
    function _targets() internal view returns (address[] memory t) {
        t = new address[](6);
        t[0] = address(qc);
        t[1] = address(art);
        t[2] = address(art.TEXT());
        t[3] = directory;
        t[4] = chunkList[0];
        t[5] = chunkList[chunkList.length - 1];
    }

    function test_nothing_takes_eth() public {
        address[] memory t = _targets();
        vm.deal(alice, 10 ether);
        for (uint256 i; i < t.length; ++i) {
            vm.prank(alice);
            (bool ok,) = t[i].call{value: 1, gas: 1_000_000}("");
            assertFalse(ok, "plain transfer");
            vm.prank(alice);
            (ok,) = t[i].call{value: 1, gas: 1_000_000}(abi.encodeWithSignature("castNet()"));
            assertFalse(ok, "value with a call");
            assertEq(t[i].balance, 0);
        }
    }

    function test_no_admin_calls() public {
        address[] memory t = _targets();
        bytes[] memory calls = new bytes[](12);
        calls[0] = abi.encodeWithSignature("withdraw()");
        calls[1] = abi.encodeWithSignature("withdraw(address,uint256)", alice, 1);
        calls[2] = abi.encodeWithSignature("pause()");
        calls[3] = abi.encodeWithSignature("transferOwnership(address)", alice);
        calls[4] = abi.encodeWithSignature("renounceOwnership()");
        calls[5] = abi.encodeWithSignature("upgradeTo(address)", alice);
        calls[6] = abi.encodeWithSignature("mint(address,uint256)", alice, 1);
        calls[7] = abi.encodeWithSignature("setNetCost(uint256)", 0);
        calls[8] = abi.encodeWithSignature("setHatcher(address)", alice);
        calls[9] = abi.encodeWithSignature("selfdestruct()");
        calls[10] = abi.encodeWithSignature("setRenderer(address)", address(mock));
        calls[11] = abi.encodeWithSignature("lock()");
        for (uint256 i; i < t.length; ++i) {
            for (uint256 j; j < calls.length; ++j) {
                vm.prank(alice);
                (bool ok,) = t[i].call{gas: 1_000_000}(calls[j]);
                assertFalse(ok, "an admin-style call from a stranger");
                vm.prank(hatcher);
                (ok,) = t[i].call{gas: 1_000_000}(calls[j]);
                assertFalse(ok, "an admin-style call from the hatcher");
            }
        }
        // the owner: only setRenderer and lock, on the game only
        for (uint256 i; i < t.length; ++i) {
            for (uint256 j; j < 10; ++j) {
                (bool ok,) = t[i].call{gas: 1_000_000}(calls[j]);
                assertFalse(ok, "an admin-style call from the owner");
            }
        }
    }

    function test_after_lock_nothing_changes() public {
        qc.lock();
        address[] memory t = _targets();
        for (uint256 i; i < t.length; ++i) {
            (bool ok,) = t[i].call{gas: 1_000_000}(abi.encodeWithSignature("setRenderer(address)", address(mock)));
            assertFalse(ok);
            (ok,) = t[i].call{gas: 1_000_000}(abi.encodeWithSignature("lock()"));
            assertFalse(ok);
        }
        assertEq(address(qc.renderer()), address(art));
    }
}

/// per slot, the tiers drawn over 20,000 nets follow the night's own tier shares (the v1.2 night of 4 Nov), and the
/// half-crazy rule turns about half the Epic shots into Rare items
contract V3FrequencyTest is S2ArtBase {
    uint256 internal constant N = 20_000;

    /// counts[k * 6 + t]: slot k drew tier t; shown[k * 6 + t]: slot k shows an item of list tier t
    function batch(uint256 from, uint256 to, bytes32 seed, uint16[16] calldata c, uint8 first)
        external
        view
        returns (uint256[66] memory counts, uint256[66] memory shown)
    {
        for (uint256 i = from; i < to; ++i) {
            uint256 id = _id(N1104, address(uint160(0xF00D0000 + i)));
            Dna memory d = qc.dnaFor(N1104, seed, id, c, TURNS_1104, STEPS_V12, first);
            if (d.status != 1) {
                ++counts[60 + 0]; // got away (main draw on tier 0)
                continue;
            }
            ++counts[60 + d.tier];
            (,, uint8[10] memory it) = art.looksOf(d);
            for (uint256 k; k < 10; ++k) {
                ++counts[k * 6 + d.tiers[k]];
                ++shown[k * 6 + it[k]];
            }
        }
    }

    function _run(uint8 first) internal view returns (uint256[66] memory counts, uint256[66] memory shown) {
        uint16[16] memory c = _counts1104v12();
        bytes32 seed = keccak256(abi.encode(BH, SHA_1104, JOB_1104));
        for (uint256 b; b < N; b += 2000) {
            (uint256[66] memory cc, uint256[66] memory ss) = this.batch(b, b + 2000, seed, c, first);
            for (uint256 i; i < 66; ++i) {
                counts[i] += cc[i];
                shown[i] += ss[i];
            }
        }
    }

    function test_slot_tiers_follow_the_nights_shares() public view {
        uint16[16] memory c = _counts1104v12();
        uint8[16] memory tiers = _refTiers(c, TURNS_1104, STEPS_V12, FIRST_1104_V12);
        uint256[6] memory share; // landings on spots of each tier (of 4000)
        for (uint256 s; s < 16; ++s) {
            share[tiers[s]] += c[s];
        }
        (uint256[66] memory counts, uint256[66] memory shown) = _run(FIRST_1104_V12);
        uint256 caught = N - counts[60];
        assertApproxEqAbs(counts[60] * 4000 / N, share[0], 60, "main: got away ~ noise share");
        for (uint256 k; k < 10; ++k) {
            for (uint256 t; t < 6; ++t) {
                // each slot of each caught net: tier t with the night's share (4 sigma at 20k: ~1.2 points)
                assertApproxEqAbs(counts[k * 6 + t] * 4000 / caught, share[t], 60, "slot tier share");
            }
        }
        // half-crazy on the Head (both its Rare and Epic lists are full): of the Epic shots, about half show Rare
        uint256 epic = counts[1 * 6 + 4];
        uint256 rareShown = shown[1 * 6 + 3];
        uint256 rareShots = counts[1 * 6 + 3];
        uint256 epicShown = shown[1 * 6 + 4];
        assertEq(rareShown + epicShown, rareShots + epic, "every Rare or Epic head shot shows a head item");
        assertApproxEqRel(epicShown * 2, epic, 0.1e18, "about half of the Epic shots stay Epic");
        assertEq(counts[1 * 6 + 5], 0, "no Legendary spot on a night whose first shot missed the Epic spot");
    }

    function test_golden_night_has_legendary_and_no_epic() public view {
        uint16[16] memory c = _counts1104v12();
        uint8[16] memory t0 = _refTiers(c, TURNS_1104, STEPS_V12, FIRST_1104_V12);
        uint8 epicSpot;
        for (uint8 s; s < 16; ++s) {
            if (t0[s] == 4) epicSpot = s;
        }
        (uint256[66] memory counts,) = _run(epicSpot);
        uint256 caught = N - counts[60];
        for (uint256 k; k < 10; ++k) {
            assertEq(counts[k * 6 + 4], 0, "a golden night has no Epic spot");
            assertApproxEqAbs(counts[k * 6 + 5] * 4000 / caught, c[epicSpot], 60, "Legendary = the Epic spot's share");
        }
    }
}

/// handler for the invariant test: random casts, posts, seals, block and clock moves, renderer swaps, a lock
contract V3Handler is V3Base {
    QuantumCatchV3 public g;
    MockRenderer public r1;
    MockRenderer public r2;
    address public deployer;
    uint32 public night;
    uint256[] public ids;
    bytes32 public firstSeed;
    uint64 public firstSeedBlock;
    mapping(uint256 => bytes32) public seen; // id -> keccak(dnaOf) once its night is sealed
    bool public wasLocked;
    address public rendererAtLock;

    constructor() {
        r1 = new MockRenderer("one");
        r2 = new MockRenderer("two");
        deployer = address(this);
        g = new QuantumCatchV3(makeAddr("hatcher"), r1, ISqk(address(0)), 0);
        night = N1104;
        vm.warp(g.nightStart(night) + 3600);
        vm.roll(POST_BLOCK - 100);
    }

    function cast(uint256 who) external {
        if (block.timestamp >= g.netsCloseAt(night)) return;
        address a = address(uint160(0xB0B000 + (who % 64)));
        if (g.balanceOf(a) != 0) return;
        vm.prank(a);
        ids.push(g.castNet());
    }

    function post() external {
        (bool posted,,,,,,,,) = g.nightRecord(night);
        if (posted) return;
        vm.warp(g.nightOverAt(night));
        vm.prank(makeAddr("hatcher"));
        g.postNight(night, _counts1104v12(), TURNS_1104, STEPS_V12, JOB_1104, SHA_1104, FIRST_1104_V12);
    }

    function seal() external {
        (uint64 pb, uint64 sb,) = g.sealOf(night);
        if (pb == 0 || sb != 0 || block.number < pb + 2) return;
        g.seal(night);
        (, firstSeedBlock, firstSeed) = g.sealOf(night);
    }

    function roll(uint8 blocks) external {
        vm.roll(block.number + 1 + blocks);
    }

    function swap(bool one) external {
        if (g.locked()) return;
        g.setRenderer(one ? r1 : r2);
    }

    function lockIt(uint8 dice) external {
        if (dice != 7 || g.locked()) return;
        g.lock();
        wasLocked = true;
        rendererAtLock = address(g.renderer());
    }

    function look(uint256 i) external {
        if (ids.length == 0) return;
        uint256 id = ids[i % ids.length];
        (, uint64 sb,) = g.sealOf(night);
        if (sb == 0) return;
        bytes32 k = keccak256(abi.encode(g.dnaOf(id)));
        if (seen[id] == bytes32(0)) seen[id] = k;
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }
}

contract V3InvariantTest is V3Base {
    V3Handler internal h;

    function setUp() public override {
        super.setUp();
        h = new V3Handler();
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](7);
        sel[0] = V3Handler.cast.selector;
        sel[1] = V3Handler.post.selector;
        sel[2] = V3Handler.seal.selector;
        sel[3] = V3Handler.roll.selector;
        sel[4] = V3Handler.swap.selector;
        sel[5] = V3Handler.lockIt.selector;
        sel[6] = V3Handler.look.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
    }

    /// a sealed night's seed never changes, and every net's raw DNA stays what it was first read as
    function invariant_the_draw_never_changes() public view {
        QuantumCatchV3 g = h.g();
        (, uint64 sb, bytes32 seed) = g.sealOf(h.night());
        if (h.firstSeedBlock() != 0) {
            assertEq(sb, h.firstSeedBlock());
            assertEq(seed, h.firstSeed());
        }
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = h.ids(i);
            bytes32 s = h.seen(id);
            if (s != bytes32(0)) assertEq(keccak256(abi.encode(g.dnaOf(id))), s);
        }
    }

    /// the owner is the deployer until lock, then nobody, for good; after lock the renderer never moves
    function invariant_owner_and_lock() public view {
        QuantumCatchV3 g = h.g();
        if (h.wasLocked()) {
            assertEq(g.owner(), address(0));
            assertTrue(g.locked());
            assertEq(address(g.renderer()), h.rendererAtLock());
        } else {
            assertEq(g.owner(), h.deployer());
        }
        address r = address(g.renderer());
        assertTrue(r == address(h.r1()) || r == address(h.r2()));
    }

    /// every cast net is held (nobody burns here) and counted
    function invariant_balances() public view {
        QuantumCatchV3 g = h.g();
        uint256 n = h.idsLength();
        for (uint256 i; i < n; ++i) {
            address a = g.ownerOf(h.ids(i));
            assertEq(g.balanceOf(a), 1);
        }
    }
}
