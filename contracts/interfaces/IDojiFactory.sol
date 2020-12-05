// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0;

interface IDojiFactory {
    function isInstrument(address instrument) external returns (bool);
}
