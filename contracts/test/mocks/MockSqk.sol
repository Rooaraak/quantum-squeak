// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// A stand-in for the Squeekchain TEST token SQK (Sepolia 0xd78a3956cf63164d1fa1c622ad3c66623162fa1e), written to
/// behave like it (OpenZeppelin v5 ERC20 + ERC20Burnable + ERC20Permit): the same custom errors (so the same revert
/// data), burn(uint256) from the caller, EIP-2612 permit with the OZ digest, low-s / v 27-28 only. Anyone can mint: a
/// mock for local tests and the anvil e2e only, never deployed to a real network.
///   MockSqk         has eip712Domain() (EIP-5267), like the real token
///   MockSqkNoDomain does not (a page must then build the domain from name() + version "1" + chainId + address)
abstract contract MockSqkBase {
    string public name;
    string public symbol = "SQK";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    uint256 public totalBurned; // the real token tracks it too
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;

    string internal _version;
    uint256 internal immutable _chainId;
    bytes32 internal immutable _separator;

    bytes32 internal constant TYPE_HASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);
    error ERC20InvalidSender(address sender);
    error ERC20InvalidReceiver(address receiver);
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    error ERC20InvalidApprover(address approver);
    error ERC20InvalidSpender(address spender);
    error ERC2612ExpiredSignature(uint256 deadline);
    error ERC2612InvalidSigner(address signer, address owner);
    error ECDSAInvalidSignature();
    error ECDSAInvalidSignatureS(bytes32 s);

    constructor(string memory name_, string memory version_) {
        name = name_;
        _version = version_;
        _chainId = block.chainid;
        _separator = _buildSeparator();
    }

    function _buildSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(TYPE_HASH, keccak256(bytes(name)), keccak256(bytes(_version)), block.chainid, address(this))
        );
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == _chainId ? _separator : _buildSeparator();
    }

    // ---- test helper: anyone can mint (mock only)
    function mint(address to, uint256 value) external {
        if (to == address(0)) revert ERC20InvalidReceiver(address(0));
        _update(address(0), to, value);
    }

    function transfer(address to, uint256 value) external virtual returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        _approve(msg.sender, spender, value, true);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external virtual returns (bool) {
        _spendAllowance(from, msg.sender, value);
        _transfer(from, to, value);
        return true;
    }

    function burn(uint256 value) external virtual {
        _update(msg.sender, address(0), value);
    }

    /// secp256k1's group order n / 2 (EIP-2: a signature's s must be in the lower half, as OpenZeppelin's ECDSA checks);
    /// written in decimal (the same number as OpenZeppelin's hex constant)
    uint256 internal constant HALF_N =
        57896044618658097711785492504343953926418782139537452191302581570759080747168;

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        if (block.timestamp > deadline) revert ERC2612ExpiredSignature(deadline);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        if (uint256(s) > HALF_N) {
            revert ECDSAInvalidSignatureS(s);
        }
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert ECDSAInvalidSignature();
        if (signer != owner) revert ERC2612InvalidSigner(signer, owner);
        _approve(owner, spender, value, true);
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (from == address(0)) revert ERC20InvalidSender(address(0));
        if (to == address(0)) revert ERC20InvalidReceiver(address(0));
        _update(from, to, value);
    }

    function _update(address from, address to, uint256 value) internal virtual {
        if (from == address(0)) {
            totalSupply += value;
        } else {
            uint256 b = balanceOf[from];
            if (b < value) revert ERC20InsufficientBalance(from, b, value);
            unchecked {
                balanceOf[from] = b - value;
            }
        }
        if (to == address(0)) {
            unchecked {
                totalSupply -= value;
            }
            totalBurned += value;
        } else {
            unchecked {
                balanceOf[to] += value;
            }
        }
        emit Transfer(from, to, value);
    }

    function _approve(address owner, address spender, uint256 value, bool emitEvent) internal {
        if (owner == address(0)) revert ERC20InvalidApprover(address(0));
        if (spender == address(0)) revert ERC20InvalidSpender(address(0));
        allowance[owner][spender] = value;
        if (emitEvent) emit Approval(owner, spender, value);
    }

    function _spendAllowance(address owner, address spender, uint256 value) internal {
        uint256 a = allowance[owner][spender];
        if (a != type(uint256).max) {
            if (a < value) revert ERC20InsufficientAllowance(spender, a, value);
            unchecked {
                _approve(owner, spender, a - value, false);
            }
        }
    }
}

contract MockSqk is MockSqkBase {
    constructor() MockSqkBase("Squeek", "1") {}

    /// EIP-5267, as OpenZeppelin returns it: fields 0x0f (name, version, chainId, verifyingContract)
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name_,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        )
    {
        return (hex"0f", name, _version, block.chainid, address(this), bytes32(0), new uint256[](0));
    }
}

/// the same token without eip712Domain()
contract MockSqkNoDomain is MockSqkBase {
    constructor() MockSqkBase("Squeek", "1") {}
}
