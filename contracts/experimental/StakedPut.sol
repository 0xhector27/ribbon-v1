// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {DSMath} from "../lib/DSMath.sol";
import {
    AggregatorV3Interface
} from "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";

import {IHegicOptions} from "../interfaces/HegicInterface.sol";
import {
    ProtocolAdapterTypes,
    IProtocolAdapter
} from "../adapters/IProtocolAdapter.sol";
import {IAmmAdapter} from "../adapters/IAmmAdapter.sol";
import {AmmAdapter} from "../adapters/AmmAdapter.sol";

import {ProtocolAdapter} from "../adapters/ProtocolAdapter.sol";
import {IRibbonFactory} from "../interfaces/IRibbonFactory.sol";
import {UniswapAdapter} from "../adapters/UniswapAdapter.sol";

import {StakedPutStorageV1} from "../storage/StakedPutStorage.sol";

contract StakedPut is DSMath, StakedPutStorageV1 {
    event PositionCreated(
        address indexed account,
        uint256 indexed positionID,
        uint256 amount
    );
    event Exercised(
        address indexed account,
        uint256 indexed positionID,
        uint256 totalProfit
    );

    struct BuyInstrumentParams {
        uint256 putStrikePrice;
        uint256 optionAmount;
        uint256 putMaxCost;
        uint256 expiry;
        uint256 lpAmt;
        uint256 tradeAmt;
        uint256 minWbtcAmtOut;
        uint256 minDiggAmtOut;
    }

    using AmmAdapter for IAmmAdapter;
    using ProtocolAdapter for IProtocolAdapter;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    IRibbonFactory public immutable factory;
    IProtocolAdapter public immutable adapter;
    IAmmAdapter public immutable iUniswapAdapter;
    AggregatorV3Interface public immutable priceProvider;

    address payable public uniswapAdapterAddress;
    string private constant instrumentName = "wbtc/digg-staked-put";
    uint256 private constant timePeriod = 2419199;
    string private constant venue = "HEGIC";
    uint8 private constant venueID = 0;

    ProtocolAdapterTypes.OptionType public constant optionType =
        ProtocolAdapterTypes.OptionType.Put;
    address public constant ethAddress = address(0);
    address public immutable wbtcAddress;
    address public immutable underlying;
    address public immutable strikeAsset;
    address public immutable collateralAsset;
    address public immutable optionsAddress;
    address public immutable adapterAddress;

    constructor(
        address _factory,
        address payable _uniswapAdapterAddress,
        address _wbtcAddress,
        address _wbtcOptionsAddress,
        address _collateralAsset,
        address _priceFeed
    ) {
        require(_factory != address(0), "!_factory");
        require(_uniswapAdapterAddress != address(0), "!_uniswapAdapter");
        require(_wbtcAddress != address(0), "!_wbtc");
        require(_wbtcOptionsAddress != address(0), "!_wbtcOptions");
        require(_collateralAsset != address(0), "!_collateral");
        require(_priceFeed != address(0), "!_priceFeed");

        wbtcAddress = _wbtcAddress;
        underlying = _wbtcAddress;
        strikeAsset = _wbtcAddress;
        collateralAsset = _collateralAsset;
        priceProvider = AggregatorV3Interface(_priceFeed);
        IRibbonFactory factoryInstance = IRibbonFactory(_factory);
        iUniswapAdapter = IAmmAdapter(_uniswapAdapterAddress);
        uniswapAdapterAddress = _uniswapAdapterAddress;
        address _adapterAddress = factoryInstance.getAdapter(venue);
        require(_adapterAddress != address(0), "Adapter not set");
        adapterAddress = _adapterAddress;
        factory = factoryInstance;
        adapter = IProtocolAdapter(_adapterAddress);
        optionsAddress = _wbtcOptionsAddress;
    }

    function initialize() external initializer {}

    receive() external payable {}

    function getName() public pure returns (string memory) {
        return instrumentName;
    }

    function getCurrentPrice() public view returns (uint256) {
        (, int256 latestPrice, , , ) = priceProvider.latestRoundData();
        uint256 currentPrice = uint256(latestPrice);
        return currentPrice.mul(10**10);
    }

    //input currency is eth
    function getInputs(uint256 amt)
        public
        view
        returns (
            uint256 wbtcSize,
            uint256 expDigg,
            uint256 tradeAmt,
            uint256 premium,
            uint256 totalCost,
            uint256 currentPrice,
            uint256 expiry
        )
    {
        wbtcSize = iUniswapAdapter.expectedWbtcOut(amt);

        (expDigg, tradeAmt) = iUniswapAdapter.expectedDiggOut(wbtcSize);

        //set expiry to a month from now
        //set strike to atm
        expiry = block.timestamp + timePeriod;
        currentPrice = uint256(getCurrentPrice());

        ProtocolAdapterTypes.OptionTerms memory optionTerms =
            ProtocolAdapterTypes.OptionTerms(
                underlying,
                strikeAsset,
                collateralAsset,
                expiry,
                currentPrice,
                optionType,
                ethAddress
            );

        premium = adapter.premium(optionTerms, wbtcSize);
        totalCost = amt.add(premium);
    }

    function buyInstrument(BuyInstrumentParams calldata params) public payable {
        require(msg.value > 0, "input must be eth");
        iUniswapAdapter.delegateBuyLp(
            params.lpAmt,
            params.tradeAmt,
            params.minWbtcAmtOut,
            params.minDiggAmtOut
        );
        uint256 positionID = buyPutFromAdapter(params);

        uint256 balance = address(this).balance;
        if (balance > 0) payable(msg.sender).transfer(balance);

        emit PositionCreated(msg.sender, positionID, params.lpAmt);
    }

    function exercisePosition(uint256 positionID)
        external
        nonReentrant
        returns (uint256 totalProfit)
    {
        InstrumentPosition storage position =
            instrumentPositions[msg.sender][positionID];
        require(!position.exercised, "Already exercised");

        uint32 optionID;

        optionID = position.putOptionID;

        uint256 amount = position.amount;

        uint256 profit =
            adapter.delegateExerciseProfit(optionsAddress, optionID, amount);
        if (profit > 0) {
            adapter.delegateExercise(
                optionsAddress,
                optionID,
                amount,
                msg.sender
            );
        }

        totalProfit += profit;

        position.exercised = true;

        emit Exercised(msg.sender, positionID, totalProfit);
    }

    function exerciseProfit(address account, uint256 positionID)
        external
        view
        returns (uint256)
    {
        InstrumentPosition storage position =
            instrumentPositions[account][positionID];

        if (position.exercised) return 0;

        uint256 profit = 0;

        uint256 amount = position.amount;

        uint32 optionID;

        optionID = position.putOptionID;

        profit += adapter.delegateExerciseProfit(
            optionsAddress,
            optionID,
            amount
        );
        return profit;
    }

    function canExercise(address account, uint256 positionID)
        external
        view
        returns (bool)
    {
        InstrumentPosition storage position =
            instrumentPositions[account][positionID];

        if (position.exercised) return false;

        bool canExercisePut = false;

        uint32 optionID;

        optionID = position.putOptionID;

        bool canExerciseOptions =
            adapter.canExercise(optionsAddress, optionID, position.amount);

        if (canExerciseOptions) {
            canExercisePut = true;
        }
        return canExercisePut;
    }

    //make this internal for production
    function buyPutFromAdapter(BuyInstrumentParams calldata params)
        public
        payable
        nonReentrant
        returns (uint256 positionID)
    {
        require(
            block.timestamp < params.expiry,
            "Cannot purchase after expiry"
        );

        ProtocolAdapterTypes.OptionTerms memory optionTerms =
            ProtocolAdapterTypes.OptionTerms(
                underlying,
                strikeAsset,
                collateralAsset,
                params.expiry,
                params.putStrikePrice,
                optionType,
                ethAddress
            );

        uint256 optionID256 =
            adapter.delegatePurchase(
                optionTerms,
                params.optionAmount,
                params.putMaxCost
            );
        uint32 optionID = uint32(optionID256);

        InstrumentPosition memory position =
            InstrumentPosition(false, venueID, optionID, params.optionAmount);

        positionID = instrumentPositions[msg.sender].length;
        instrumentPositions[msg.sender].push(position);
    }
}
