// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {QuantumCatch, IPaintedArt, ISqk} from "../src/QuantumCatch.sol";
import {SqkFaucet, IERC20} from "../src/SqkFaucet.sol";

/// the real token's extra views (read-only)
interface IRealSqk is ISqk {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function totalBurned() external view returns (uint256);
    function nonces(address owner) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function transfer(address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function eip712Domain()
        external
        view
        returns (bytes1, string memory, string memory, uint256, address, bytes32, uint256[] memory);
}

/// v2 against the REAL Squeekchain test SQK on a local fork of Sepolia (nothing is sent to any network: the fork lives
/// in this test run). Runs only with SEPOLIA_RPC set, else every test is skipped:
///   SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com SEPOLIA_FORK_BLOCK=<a recent block> \
///     forge test --match-path test/SqkFork.t.sol -vv
/// SEPOLIA_FORK_BLOCK pins the block (default 0 = latest). A public node keeps only recent state, so pin a block a few
/// behind the head (its load balancer may not know the very latest one yet); 12076647 (6 Nov 2026) needs an archive
/// node. The faucet's test SQK comes from forge's deal() on the fork, the hatcher is a stand-in (no live keys named).
contract SqkForkTest is Test {
    IRealSqk internal constant SQK = IRealSqk(0xd78a3956cF63164d1Fa1C622ad3c66623162Fa1e);
    IPaintedArt internal constant ART = IPaintedArt(0x76f4416475E5E3B26F8b4780EFEb69B7a34262Cb); // live PaintedArt
    uint256 internal constant COST = 1e16; // 0.01 test SQK
    uint256 internal constant DRIP = 1e16; // 0.01 test SQK: one net per wallet per net night

    address internal hatcher = makeAddr("fork-hatcher"); // a stand-in: only postNight needs the real one
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    QuantumCatch internal qc;
    SqkFaucet internal faucet;
    bool internal forked;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC", string(""));
        if (bytes(rpc).length == 0) return; // each test skips itself
        uint256 blockNo = vm.envOr("SEPOLIA_FORK_BLOCK", uint256(0));
        if (blockNo == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, blockNo);
        forked = true;
        assertEq(block.chainid, 11155111, "Sepolia");
        qc = new QuantumCatch(hatcher, ART, ISqk(address(SQK)), COST);
        faucet = new SqkFaucet(IERC20(address(SQK)), DRIP, address(qc));
        // on the fork only: a holder refills the faucet with a plain transfer of real test SQK
        address holder = makeAddr("fork-holder");
        deal(address(SQK), holder, 3 * DRIP);
        vm.prank(holder);
        assertTrue(SQK.transfer(address(faucet), 3 * DRIP));
    }

    modifier onFork() {
        vm.skip(!forked, "SEPOLIA_RPC not set");
        _;
    }

    function _sign(uint256 pk, address owner, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 h = keccak256(abi.encode(PERMIT_TYPEHASH, owner, address(qc), value, SQK.nonces(owner), deadline));
        return vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", SQK.DOMAIN_SEPARATOR(), h)));
    }

    function test_fork_the_real_token_is_what_the_game_expects() public onFork {
        assertEq(SQK.name(), "Squeek");
        assertEq(SQK.symbol(), "SQK");
        assertEq(SQK.decimals(), 18);
        (
            bytes1 fields,
            string memory n,
            string memory ver,
            uint256 chainId,
            address vc,
            bytes32 salt,
            uint256[] memory ext
        ) = SQK.eip712Domain();
        assertEq(uint8(fields), 0x0f, "name, version, chainId, verifyingContract");
        assertEq(n, "Squeek");
        assertEq(ver, "1");
        assertEq(chainId, 11155111);
        assertEq(vc, address(SQK));
        assertEq(salt, bytes32(0));
        assertEq(ext.length, 0);
        bytes32 sep = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Squeek"),
                keccak256("1"),
                uint256(11155111),
                address(SQK)
            )
        );
        assertEq(SQK.DOMAIN_SEPARATOR(), sep, "the page's domain (both ways) is the token's");
        (bool ok,) = address(SQK).staticcall(abi.encodeWithSignature("burnFrom(address,uint256)", address(this), 1));
        assertFalse(ok, "no burnFrom: the game pulls with transferFrom, then burns its own");
        assertEq(address(qc.SQK()), address(SQK));
        assertEq(qc.NET_COST(), COST);
        assertEq(address(qc.ART()), address(ART));
        assertEq(qc.HATCHER(), hatcher);
        assertEq(address(faucet.CATCH()), address(qc));
        assertEq(faucet.DRIP(), qc.NET_COST());
    }

    function test_fork_faucet_claim_then_permit_cast_burns_real_sqk() public onFork {
        (address player, uint256 pk) = makeAddrAndKey("fork-player");
        assertEq(SQK.balanceOf(player), 0);
        assertEq(faucet.remaining(), 3 * DRIP);
        vm.prank(player);
        uint256 g = gasleft();
        faucet.claim();
        console2.log("gas: faucet claim (real SQK)", g - gasleft());
        assertFalse(faucet.canClaim(player));
        assertEq(SQK.balanceOf(player), DRIP, "no transfer fee");
        assertEq(faucet.remaining(), 2 * DRIP);
        uint32 tonight = qc.openNight();
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(SqkFaucet.AlreadyClaimedTonight.selector, tonight));
        faucet.claim();

        uint256 supply = SQK.totalSupply();
        uint256 burned = SQK.totalBurned();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(pk, player, COST, deadline);
        uint32 night = qc.openNight();
        vm.expectEmit(true, true, false, true, address(qc));
        emit QuantumCatch.NetPaid(night, player, COST);
        vm.prank(player);
        g = gasleft();
        uint256 id = qc.castNetWithPermit(deadline, v, r, s);
        console2.log("gas: castNetWithPermit (real SQK)", g - gasleft());
        assertEq(qc.ownerOf(id), player);
        assertEq(SQK.nonces(player), 1, "the real permit was used");
        assertEq(SQK.allowance(player, address(qc)), 0);
        assertEq(SQK.balanceOf(player), 0, "one claim = one net");
        assertEq(SQK.balanceOf(address(qc)), 0, "the game keeps nothing");
        assertEq(SQK.totalSupply(), supply - COST, "a real burn: total supply down by the cost");
        assertEq(SQK.totalBurned(), burned + COST, "and the token's own burn counter up by it");
        (uint8 status,, uint8 spot,,,,) = qc.result(id);
        assertEq(status, 0, "waiting for the chip");
        assertEq(spot, 255, "no spot until the chip result is posted");
        assertGt(bytes(qc.tokenURI(id)).length, 1000);
    }

    function test_fork_approve_then_castNet_and_front_run_permit() public onFork {
        (address a, uint256 pkA) = makeAddrAndKey("fork-a");
        (address b, uint256 pkB) = makeAddrAndKey("fork-b");
        vm.prank(a);
        faucet.claim();
        vm.prank(b);
        faucet.claim();
        uint256 supply = SQK.totalSupply();

        // a: plain approve + castNet (the fallback when a wallet cannot sign typed data)
        vm.prank(a);
        assertTrue(SQK.approve(address(qc), COST));
        vm.prank(a);
        uint256 g = gasleft();
        qc.castNet();
        console2.log("gas: castNet after approve (real SQK)", g - gasleft());
        assertEq(SQK.balanceOf(a), 0);

        // b: someone submits b's permit first; b's castNetWithPermit still casts with the allowance it left
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(pkB, b, COST, deadline);
        SQK.permit(b, address(qc), COST, deadline, v, r, s);
        vm.prank(b);
        qc.castNetWithPermit(deadline, v, r, s);
        assertEq(SQK.balanceOf(b), 0);

        // a again tonight (with SQK from elsewhere): one net per wallet per night, nothing charged
        deal(address(SQK), a, COST);
        (v, r, s) = _sign(pkA, a, COST, deadline);
        uint32 night = qc.openNight();
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.AlreadyCast.selector, night, a));
        qc.castNetWithPermit(deadline, v, r, s);
        assertEq(SQK.balanceOf(a), COST);
        assertEq(SQK.totalSupply(), supply - 2 * COST);
        assertEq(SQK.balanceOf(address(qc)), 0);
    }

    function test_fork_no_sqk_no_net_and_the_faucet_runs_dry() public onFork {
        address broke = makeAddr("fork-broke");
        vm.prank(broke);
        vm.expectRevert(abi.encodeWithSignature("ERC20InsufficientAllowance(address,uint256,uint256)", qc, 0, COST));
        qc.castNet(); // the real token's own OpenZeppelin errors bubble up
        vm.prank(broke);
        SQK.approve(address(qc), COST);
        vm.prank(broke);
        vm.expectRevert(abi.encodeWithSignature("ERC20InsufficientBalance(address,uint256,uint256)", broke, 0, COST));
        qc.castNet();
        for (uint256 i; i < 3; ++i) {
            vm.prank(makeAddr(string.concat("fork-c", vm.toString(i))));
            faucet.claim();
        }
        assertEq(faucet.remaining(), 0);
        vm.prank(broke);
        vm.expectRevert(SqkFaucet.FaucetEmpty.selector);
        faucet.claim();
    }
}
