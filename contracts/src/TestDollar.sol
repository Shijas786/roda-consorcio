// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet-only faucet dollar (6 decimals, like USDG) so anyone can try Roda without real funds.
contract TestDollar is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000e6;
    uint256 public constant COOLDOWN = 1 hours;

    mapping(address => uint256) public nextMintAt;

    error CooldownActive(uint256 availableAt);

    constructor() ERC20("Roda Test Dollar", "tUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet() external {
        if (block.timestamp < nextMintAt[msg.sender]) revert CooldownActive(nextMintAt[msg.sender]);
        nextMintAt[msg.sender] = block.timestamp + COOLDOWN;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
