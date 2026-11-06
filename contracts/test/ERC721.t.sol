// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CatchBase} from "./Base.t.sol";
import {QuantumCatch} from "../src/QuantumCatch.sol";

contract GoodReceiver {
    address public lastOperator;
    address public lastFrom;
    uint256 public lastId;
    bytes public lastData;

    function onERC721Received(address operator, address from, uint256 id, bytes calldata data)
        external
        returns (bytes4)
    {
        lastOperator = operator;
        lastFrom = from;
        lastId = id;
        lastData = data;
        return this.onERC721Received.selector;
    }
}

contract WrongSelectorReceiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}

contract RevertingReceiver {
    error NoThanks();

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert NoThanks();
    }
}

contract NotAReceiver {}

contract ERC721Test is CatchBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _cast(alice, 6);
    }

    function test_supportsInterface() public view {
        assertTrue(qc.supportsInterface(0x01ffc9a7)); // ERC-165
        assertTrue(qc.supportsInterface(0x80ac58cd)); // ERC-721
        assertTrue(qc.supportsInterface(0x5b5e139f)); // ERC-721 Metadata
        assertTrue(qc.supportsInterface(0x49064906)); // ERC-4906 metadata update
        assertFalse(qc.supportsInterface(0x780e9d63)); // not Enumerable
        assertFalse(qc.supportsInterface(0xffffffff));
    }

    function test_balanceOf_zero_address_reverts() public {
        vm.expectRevert(QuantumCatch.ZeroOwner.selector);
        qc.balanceOf(address(0));
        assertEq(qc.balanceOf(bob), 0);
    }

    function test_ownerOf_and_getApproved_missing_token_revert() public {
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, id + 1));
        qc.ownerOf(id + 1);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, id + 1));
        qc.getApproved(id + 1);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, id + 1));
        qc.approve(bob, id + 1);
    }

    function test_approve_by_owner() public {
        vm.expectEmit(true, true, true, true, address(qc));
        emit QuantumCatch.Approval(alice, bob, id);
        vm.prank(alice);
        qc.approve(bob, id);
        assertEq(qc.getApproved(id), bob);
    }

    function test_approve_by_operator() public {
        vm.prank(alice);
        qc.setApprovalForAll(carol, true);
        vm.prank(carol);
        qc.approve(bob, id);
        assertEq(qc.getApproved(id), bob);
    }

    function test_approve_by_stranger_or_approved_reverts() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NotOwnerNorApproved.selector, bob, id));
        qc.approve(bob, id);
        vm.prank(alice);
        qc.approve(bob, id);
        vm.prank(bob); // a single-token approval does not let bob re-approve
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NotOwnerNorApproved.selector, bob, id));
        qc.approve(carol, id);
    }

    function test_setApprovalForAll() public {
        vm.expectEmit(true, true, false, true, address(qc));
        emit QuantumCatch.ApprovalForAll(alice, bob, true);
        vm.prank(alice);
        qc.setApprovalForAll(bob, true);
        assertTrue(qc.isApprovedForAll(alice, bob));
        vm.prank(alice);
        qc.setApprovalForAll(bob, false);
        assertFalse(qc.isApprovedForAll(alice, bob));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.InvalidOperator.selector, address(0)));
        qc.setApprovalForAll(address(0), true);
    }

    function test_hatcher_can_never_be_approved_or_receive() public {
        vm.prank(alice);
        vm.expectRevert(QuantumCatch.HatcherIsNotAPlayer.selector);
        qc.approve(hatcher, id);
        vm.prank(alice);
        vm.expectRevert(QuantumCatch.HatcherIsNotAPlayer.selector);
        qc.setApprovalForAll(hatcher, true);
        vm.prank(alice);
        qc.setApprovalForAll(hatcher, false); // revoking is always fine
        vm.prank(alice);
        vm.expectRevert(QuantumCatch.HatcherIsNotAPlayer.selector);
        qc.transferFrom(alice, hatcher, id);
        vm.prank(alice);
        vm.expectRevert(QuantumCatch.HatcherIsNotAPlayer.selector);
        qc.safeTransferFrom(alice, hatcher, id);
    }

    function test_hatcher_cannot_move_a_net() public {
        vm.prank(hatcher);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NotOwnerNorApproved.selector, hatcher, id));
        qc.transferFrom(alice, bob, id);
        vm.prank(hatcher);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NotOwnerNorApproved.selector, hatcher, id));
        qc.approve(bob, id);
        assertEq(qc.ownerOf(id), alice);
    }

    function test_transferFrom_by_owner_clears_approval() public {
        vm.prank(alice);
        qc.approve(carol, id);
        vm.expectEmit(true, true, true, true, address(qc));
        emit QuantumCatch.Transfer(alice, bob, id);
        vm.prank(alice);
        qc.transferFrom(alice, bob, id);
        assertEq(qc.ownerOf(id), bob);
        assertEq(qc.balanceOf(alice), 0);
        assertEq(qc.balanceOf(bob), 1);
        assertEq(qc.getApproved(id), address(0));
    }

    function test_transferFrom_by_approved_and_operator() public {
        vm.prank(alice);
        qc.approve(bob, id);
        vm.prank(bob);
        qc.transferFrom(alice, carol, id);
        assertEq(qc.ownerOf(id), carol);
        vm.prank(carol);
        qc.setApprovalForAll(alice, true);
        vm.prank(alice);
        qc.transferFrom(carol, alice, id);
        assertEq(qc.ownerOf(id), alice);
    }

    function test_transferFrom_rejects_stranger_wrong_from_zero_to() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NotOwnerNorApproved.selector, bob, id));
        qc.transferFrom(alice, bob, id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.WrongFrom.selector, bob, id));
        qc.transferFrom(bob, carol, id);
        vm.prank(alice);
        vm.expectRevert(QuantumCatch.TransferToZero.selector);
        qc.transferFrom(alice, address(0), id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, id + 1));
        qc.transferFrom(alice, bob, id + 1);
    }

    function test_transfer_to_self_keeps_balance() public {
        vm.prank(alice);
        qc.transferFrom(alice, alice, id);
        assertEq(qc.balanceOf(alice), 1);
        assertEq(qc.ownerOf(id), alice);
    }

    function test_safeTransferFrom_to_eoa() public {
        vm.prank(alice);
        qc.safeTransferFrom(alice, bob, id);
        assertEq(qc.ownerOf(id), bob);
    }

    function test_safeTransferFrom_to_a_receiver_passes_data() public {
        GoodReceiver r = new GoodReceiver();
        vm.prank(alice);
        qc.approve(carol, id);
        vm.prank(carol);
        qc.safeTransferFrom(alice, address(r), id, hex"c0ffee");
        assertEq(qc.ownerOf(id), address(r));
        assertEq(r.lastOperator(), carol);
        assertEq(r.lastFrom(), alice);
        assertEq(r.lastId(), id);
        assertEq(r.lastData(), hex"c0ffee");
        uint256 id2 = _cast(bob, 1);
        vm.prank(bob);
        qc.safeTransferFrom(bob, address(r), id2);
        assertEq(r.lastData(), "");
    }

    function test_safeTransferFrom_to_a_rejecting_contract_reverts() public {
        WrongSelectorReceiver w = new WrongSelectorReceiver();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.InvalidReceiver.selector, address(w)));
        qc.safeTransferFrom(alice, address(w), id);

        RevertingReceiver rr = new RevertingReceiver();
        vm.prank(alice);
        vm.expectRevert(RevertingReceiver.NoThanks.selector); // the receiver's own reason bubbles up
        qc.safeTransferFrom(alice, address(rr), id, "x");

        NotAReceiver nr = new NotAReceiver();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.InvalidReceiver.selector, address(nr)));
        qc.safeTransferFrom(alice, address(nr), id);

        assertEq(qc.ownerOf(id), alice);
    }

    function test_plain_transferFrom_to_a_contract_does_not_call_it() public {
        NotAReceiver nr = new NotAReceiver();
        vm.prank(alice);
        qc.transferFrom(alice, address(nr), id);
        assertEq(qc.ownerOf(id), address(nr));
    }
}
