// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// This is a simple implementation of an OFT (Omnichain Fungible Token) contract
// MyOFT.json is the hardhat compiled artifact for this contract

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { OFT } from "@layerzerolabs/oft-evm/contracts/OFT.sol";

contract MyOFT is OFT {

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        address _lzEndpoint,
        address _delegate
    ) OFT(_name, _symbol, _lzEndpoint, _delegate) Ownable(_delegate) {
        _mint(_delegate, _initialSupply * 10 ** decimals());
    }
}
