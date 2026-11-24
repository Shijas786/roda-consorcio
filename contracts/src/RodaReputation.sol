// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title RodaReputation
/// @notice Append-only payment history per address, written only by circles the factory deployed.
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
    mapping(address member => Record) private _records;

    event CircleAuthorized(address indexed circle);
    event OutcomeRecorded(
        address indexed circle, address indexed member, uint256 lateRounds, bool defaulted, uint256 volume
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

    /// @param lateRounds rounds the member's security deposit had to cover
    /// @param defaulted true if the member finished the circle still owing contributions
    /// @param volume total contributions the member paid in the circle
    function record(address member, uint256 lateRounds, bool defaulted, uint256 volume) external {
        if (!isCircle[msg.sender]) revert NotCircle();
        Record storage r = _records[member];
        if (defaulted) {
            r.defaults += 1;
        } else {
            r.circlesCompleted += 1;
            if (lateRounds == 0) r.cleanCircles += 1;
        }
        r.lateRounds += uint32(lateRounds);
        r.volume += uint128(volume);
        emit OutcomeRecorded(msg.sender, member, lateRounds, defaulted, volume);
    }

    function recordOf(address member) external view returns (Record memory) {
        return _records[member];
    }

    /// @notice 0 for anyone with a default on record, otherwise points for every completed circle.
    function scoreOf(address member) external view returns (uint256) {
        Record storage r = _records[member];
        if (r.defaults != 0) return 0;
        return CLEAN_POINTS * r.cleanCircles + LATE_POINTS * (r.circlesCompleted - r.cleanCircles);
    }
}
