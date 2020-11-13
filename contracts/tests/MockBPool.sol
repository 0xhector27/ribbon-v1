// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0;

import "../lib/DSMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockBPool is DSMath {
    bool private _isFinalized;
    uint256 private _spotPrice;
    address[] public tokens;

    function finalize() public {
        require(!_isFinalized, "Already finalized");
        _isFinalized = true;
    }

    function bind(
        address token,
        uint256 balance,
        uint256 denorm
    ) external {
        tokens.push(token);
    }

    function swapExactAmountIn(
        address tokenIn,
        uint256 tokenAmountIn,
        address tokenOut,
        uint256 minAmountOut,
        uint256 maxPrice
    ) external returns (uint256 tokenAmountOut, uint256 spotPriceAfter) {
        require(_spotPrice > 0, "Spot price is not set yet, call setSpotPrice");

        IERC20 erc20TokenIn = IERC20(tokenIn);
        IERC20 erc20TokenOut = IERC20(tokenOut);

        require(
            erc20TokenIn.transferFrom(msg.sender, address(this), tokenAmountIn),
            "Transfer failed"
        );

        tokenAmountOut = wmul(tokenAmountIn, _spotPrice);
        require(tokenAmountOut >= minAmountOut, "Less than minAmountOut");

        require(
            erc20TokenOut.transfer(msg.sender, tokenAmountOut),
            "Transfer failed"
        );

        // Just return the same spotPrice even though it would have moved
        spotPriceAfter = _spotPrice;
    }

    function getNumTokens() public view returns (uint256) {
        if (isFinalized()) {
            return 2;
        }
        return 0;
    }

    function getSpotPrice(address tokenIn, address tokenOut)
        external
        view
        returns (uint256)
    {
        return _spotPrice;
    }

    function setSpotPrice(uint256 spotPrice) external {
        _spotPrice = spotPrice;
    }

    function isFinalized() public view returns (bool) {
        return _isFinalized;
    }
}
