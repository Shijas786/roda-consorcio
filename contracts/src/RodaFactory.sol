// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {RodaCircle} from "./RodaCircle.sol";
import {RodaReputation} from "./RodaReputation.sol";

/// @title RodaFactory
/// @notice Deploys savings circles as minimal proxies and keeps the stablecoin allowlist.
contract RodaFactory is Ownable2Step {
    address public immutable implementation;
    RodaReputation public immutable reputation;

    mapping(address token => bool) public tokenAllowed;
    address[] private _circles;

    event TokenAllowed(address indexed token, bool allowed);
    event CircleCreated(
        address indexed circle,
        address indexed creator,
        address indexed token,
        uint256 contribution,
        uint256 size,
        uint256 period,
        uint256 deposit,
        uint256 minScore,
        string name
    );

    error TokenNotAllowed();

    constructor(address owner_) Ownable(owner_) {
        implementation = address(new RodaCircle());
        reputation = new RodaReputation(address(this));
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        tokenAllowed[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function createCircle(RodaCircle.Config calldata config) external returns (address circle) {
        if (!tokenAllowed[config.token]) revert TokenNotAllowed();
        circle = Clones.clone(implementation);
        RodaCircle(circle).initialize(config, reputation, msg.sender);
        reputation.authorize(circle);
        _circles.push(circle);
        emit CircleCreated(
            circle,
            msg.sender,
            config.token,
            config.contribution,
            config.size,
            config.period,
            config.deposit,
            config.minScore,
            config.name
        );
    }

    function circleCount() external view returns (uint256) {
        return _circles.length;
    }

    /// @notice Page through deployed circles, newest last.
    function circles(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 total = _circles.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            page[i - offset] = _circles[i];
        }
    }
}
