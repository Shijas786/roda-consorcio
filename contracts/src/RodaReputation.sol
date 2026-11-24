// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title RodaReputation
/// @notice Append-only payment history per address and token, written only by circles the factory deployed.
/// @dev History is kept per token so that circles in a worthless token cannot buy a score in a valuable one.
contract RodaReputation {
    struct Record {
        uint32 circlesCompleted;
        uint32 cleanCircles;
        uint32 lateRounds;
        uint32 defaults;
        uint128 volume;
    }

    uint256 public constant CLEAN_POINTS = 10;
    uint256 public constant LATE_POINTS = 4;

    address public immutable factory;
    mapping(address circle => bool) public isCircle;
    mapping(address token => mapping(address member => Record)) private _records;

    event CircleAuthorized(address indexed circle);
    event OutcomeRecorded(
        address indexed circle,
        address indexed member,
        address indexed token,
        uint256 lateRounds,
        bool defaulted,
        uint256 volume
    );

    error NotFactory();
    error NotCircle();

    constructor(address factory_) {
        factory = factory_;
    }

    function authorize(address circle) external {
        if (msg.sender != factory) revert NotFactory();
        isCircle[circle] = true;
        emit CircleAuthorized(circle);
    }

    /// @param token the circle's currency
    /// @param lateRounds rounds the member's security deposit had to cover
    /// @param defaulted true if the member finished the circle still owing contributions
    /// @param volume total contributions the member paid in the circle
    function record(address member, address token, uint256 lateRounds, bool defaulted, uint256 volume) external {
        if (!isCircle[msg.sender]) revert NotCircle();
        Record storage r = _records[token][member];
        if (defaulted) {
            r.defaults += 1;
        } else {
            r.circlesCompleted += 1;
            if (lateRounds == 0) r.cleanCircles += 1;
        }
        r.lateRounds += uint32(lateRounds);
        r.volume += uint128(volume);
        emit OutcomeRecorded(msg.sender, member, token, lateRounds, defaulted, volume);
    }

    function recordOf(address member, address token) external view returns (Record memory) {
        return _records[token][member];
    }

    /// @notice 0 for anyone with a default on record in `token`, otherwise points for every circle completed in it.
    function scoreOf(address member, address token) external view returns (uint256) {
        Record storage r = _records[token][member];
        if (r.defaults != 0) return 0;
        return CLEAN_POINTS * r.cleanCircles + LATE_POINTS * (r.circlesCompleted - r.cleanCircles);
    }
}
