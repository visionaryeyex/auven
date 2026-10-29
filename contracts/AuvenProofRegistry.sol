// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @notice Stores commitments to AUVEN-signed proof bundles.
/// @dev ML-DSA signatures are verified offchain; this contract records only a hash.
contract AuvenProofRegistry {
    address public immutable publisher;
    mapping(bytes32 => uint256) public committedAtBlock;

    event ProofCommitted(bytes32 indexed commitment, address indexed publisher);

    error NotPublisher();
    error InvalidCommitment();
    error AlreadyCommitted();

    constructor(address publisher_) {
        if (publisher_ == address(0)) revert NotPublisher();
        publisher = publisher_;
    }

    function commit(bytes32 commitment) external {
        if (msg.sender != publisher) revert NotPublisher();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (committedAtBlock[commitment] != 0) revert AlreadyCommitted();
        committedAtBlock[commitment] = block.number;
        emit ProofCommitted(commitment, msg.sender);
    }
}
