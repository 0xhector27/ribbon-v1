// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0;
pragma experimental ABIEncoderV2;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GammaAdapter} from "../adapters/GammaAdapter.sol";

contract MockGammaAdapter is GammaAdapter {
    constructor(
        address _oTokenFactory,
        address _gammaController,
        address _marginPool,
        address _usdcEthPriceFeed,
        address _uniswapRouter,
        address _weth,
        address _usdc,
        address _zeroExExchange
    )
        GammaAdapter(
            _oTokenFactory,
            _gammaController,
            _marginPool,
            _usdcEthPriceFeed,
            _uniswapRouter,
            _weth,
            _usdc,
            _zeroExExchange
        )
    {}

    function mockedExercise(
        address options,
        uint256 optionID,
        uint256 amount,
        address recipient
    ) external payable {
        IERC20 otoken = IERC20(options);
        // simulate burning otokens by transferring it to an unusable address
        otoken.transfer(
            0x0000000000000000000000000000000000000069,
            amount / 10**10
        );

        exercise(options, optionID, amount, recipient);
    }

    function swapExercisedProfits(
        address otokenAddress,
        uint256 profitInCollateral,
        address recipient
    ) external {
        swapExercisedProfitsToUnderlying(
            otokenAddress,
            profitInCollateral,
            recipient
        );
    }
}
