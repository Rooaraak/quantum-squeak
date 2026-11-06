// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/console2.sol";
import {CatchBase} from "./Base.t.sol";
import {MockSqk} from "./mocks/MockSqk.sol";
import {QuantumCatch, ISqk} from "../src/QuantumCatch.sol";
import {SqkFaucet, IERC20} from "../src/SqkFaucet.sol";

/// Representative calls for the gas report (forge test --gas-report). The gasleft() numbers logged here are the
/// execution cost of the call inside one test transaction (no 21k base, warm contract); the report is the reference.
contract CatchGasTest is CatchBase {
    function test_gas_castNet() public {
        vm.prank(alice);
        uint256 g = gasleft();
        qc.castNet();
        console2.log("castNet (first net of a wallet)", g - gasleft());
        vm.warp(LOCK_1104);
        vm.prank(alice);
        g = gasleft();
        qc.castNet();
        console2.log("castNet (wallet already holds a net)", g - gasleft());
    }

    function test_gas_postNight() public {
        vm.warp(OVER_1104);
        uint16[16] memory c = _counts1104();
        vm.prank(hatcher);
        uint256 g = gasleft();
        qc.postNight(N1104, c, TURNS_1104, STEPS_1104, JOB_1104, SHA_1104, FIRST_1104);
        console2.log("postNight (ran)", g - gasleft());
        uint16[16] memory zero;
        vm.prank(hatcher);
        g = gasleft();
        qc.postNight(N1104 - 1, zero, 0, 0, 0, 0, 0);
        console2.log("postNight (he slept)", g - gasleft());
    }

    function test_gas_transfers() public {
        uint256 id = _cast(alice);
        vm.prank(alice);
        uint256 g = gasleft();
        qc.transferFrom(alice, bob, id);
        console2.log("transferFrom (to a new holder)", g - gasleft());
        vm.prank(bob);
        g = gasleft();
        qc.safeTransferFrom(bob, carol, id);
        console2.log("safeTransferFrom (to an EOA)", g - gasleft());
        vm.prank(carol);
        g = gasleft();
        qc.burn(id);
        console2.log("burn (by its holder)", g - gasleft());
    }

    function test_gas_tokenURI() public {
        uint256 a = _castOn(15, _counts1104());
        uint256 b = _castOn(0, _counts1104());
        uint256 g = gasleft();
        qc.tokenURI(a);
        console2.log("tokenURI (waiting)", g - gasleft());
        _post1104();
        g = gasleft();
        qc.tokenURI(a);
        console2.log("tokenURI (caught, Common)", g - gasleft());
        g = gasleft();
        qc.tokenURI(b);
        console2.log("tokenURI (got away, out of reach)", g - gasleft());
        g = gasleft();
        qc.result(a);
        console2.log("result (draws the spot)", g - gasleft());
        g = gasleft();
        qc.traitsOf(a);
        console2.log("traitsOf", g - gasleft());
    }
}

/// v2: a paid net (approve first, or a permit in the same call) and a faucet claim
contract CatchGasPaidTest is CatchBase {
    MockSqk internal sqk;
    SqkFaucet internal faucet;

    function setUp() public override {
        sqk = new MockSqk();
        qc = new QuantumCatch(hatcher, NO_ART, ISqk(address(sqk)), 1e16);
        faucet = new SqkFaucet(IERC20(address(sqk)), 1e16, address(qc));
        sqk.mint(address(faucet), 1e18);
        vm.warp(START_1104 + 3600);
    }

    function test_gas_castNet_paid() public {
        sqk.mint(alice, 1e18);
        vm.prank(alice);
        sqk.approve(address(qc), 1e16);
        vm.prank(alice);
        uint256 g = gasleft();
        qc.castNet();
        console2.log("castNet paid (approved before; first net of a wallet)", g - gasleft());
    }

    function test_gas_castNetWithPermit() public {
        (address eve, uint256 pk) = makeAddrAndKey("eve");
        sqk.mint(eve, 1e18);
        uint256 deadline = block.timestamp + 600;
        bytes32 h = keccak256(abi.encode(sqk.PERMIT_TYPEHASH(), eve, address(qc), uint256(1e16), uint256(0), deadline));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", sqk.DOMAIN_SEPARATOR(), h)));
        vm.prank(eve);
        uint256 g = gasleft();
        qc.castNetWithPermit(deadline, v, r, s);
        console2.log("castNetWithPermit (first net of a wallet)", g - gasleft());
    }

    function test_gas_faucet_claim() public {
        vm.prank(alice);
        uint256 g = gasleft();
        faucet.claim();
        console2.log("faucet claim", g - gasleft());
    }
}
