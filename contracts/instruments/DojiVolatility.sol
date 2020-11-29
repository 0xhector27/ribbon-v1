// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0;
pragma experimental ABIEncoderV2;

import "../lib/upgrades/Initializable.sol";
import "../lib/DSMath.sol";
import "../interfaces/InstrumentInterface.sol";
import "../interfaces/HegicInterface.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./DojiVolatilityStorage.sol";

contract DojiVolatility is
    Initializable,
    InstrumentInterface,
    ReentrancyGuard,
    DSMath,
    DojiVolatilityStorageV1
{
    enum Protocols {Unknown, HegicBTC, HegicETH, OpynV1}
    uint8 constant STATIC_PROTOCOL = uint8(Protocols.HegicETH);

    event PositionCreated(
        address account,
        uint256 positionID,
        uint256 costOfCall,
        uint256 costOfPut,
        uint8 callOptionProtocol,
        uint8 putOptionProtocol,
        uint256 callOptionAmount,
        uint256 putOptionAmount,
        uint256 callOptionID,
        uint256 putOptionID
    );

    function initialize(
        address _owner,
        string memory name,
        string memory symbol,
        uint256 _expiry,
        uint256 _strikePrice,
        address _hegicOptions
    ) public initializer {
        require(block.timestamp < _expiry, "Expiry has already passed");

        owner = _owner;
        _name = name;
        _symbol = symbol;
        expiry = _expiry;
        strikePrice = _strikePrice;
        hegicOptions = _hegicOptions;
    }

    /**
     * @notice Buy instrument and create the underlying options positions
     * @param _amount is amount of instruments to purchase
     */
    function buyInstrument(uint256 _amount) public payable nonReentrant {
        require(block.timestamp < expiry, "Cannot buy instrument after expiry");

        (
            InstrumentPosition memory position,
            uint256 costOfCall,
            uint256 costOfPut
        ) = createHegicOptions(_amount);

        uint256 positionID = instrumentPositions[msg.sender].length;
        instrumentPositions[msg.sender].push(position);

        emit PositionCreated(
            msg.sender,
            positionID,
            costOfCall,
            costOfPut,
            position.callProtocol,
            position.putProtocol,
            _amount,
            _amount,
            position.callOptionID,
            position.putOptionID
        );
    }

    /**
     * @notice Buy instrument and create the underlying options positions
     * @param _amount is amount of instruments to purchase
     */
    function createHegicOptions(uint256 _amount)
        internal
        returns (
            InstrumentPosition memory position,
            uint256 costOfCall,
            uint256 costOfPut
        )
    {
        uint256 period = expiry - block.timestamp;
        IHegicETHOptions options = IHegicETHOptions(hegicOptions);

        (uint256 totalCost, uint256 callCost, uint256 putCost) = getHegicCost(
            _amount
        );
        costOfCall = callCost;
        costOfPut = putCost;

        require(msg.value >= totalCost, "Value does not cover total cost");

        uint256 callOptionID = options.create{value: costOfCall}(
            period,
            _amount,
            strikePrice,
            OptionType.Call
        );
        uint256 putOptionID = options.create{value: costOfPut}(
            period,
            _amount,
            strikePrice,
            OptionType.Put
        );

        position = InstrumentPosition(
            false,
            STATIC_PROTOCOL,
            STATIC_PROTOCOL,
            uint32(callOptionID),
            uint32(putOptionID),
            _amount,
            _amount
        );
    }

    /**
     * @notice Deposits collateral into the system. Calls the `depositInteral` function
     * @param _amount is amount of collateral to deposit
     */
    function deposit(uint256 _amount) public override payable nonReentrant {
        raiseNotImplemented();
        require(_amount == 0);
    }

    /**
     * @notice Mints dTokens. Calls the `mintInternal` function
     * @param _amount is amount of dToken to mint
     */
    function mint(uint256 _amount) public override nonReentrant {
        raiseNotImplemented();
        require(_amount == 0);
    }

    /**
     * @notice Deposits collateral and mints dToken atomically
     * @param _collateral is amount of collateral to deposit
     * @param _dToken is amount of dTokens to mint
     */
    function depositAndMint(uint256 _collateral, uint256 _dToken)
        external
        override
        payable
        nonReentrant
    {
        raiseNotImplemented();
        require(_collateral == 0 && _dToken == 0);
    }

    /**
     * @notice Deposits collateral, mints dToken, sells dToken atomically
     * @param _collateral is amount of collateral to deposit
     * @param _dToken is amount of dTokens to mint
     * @param _maxSlippage is max % amount of slippage in WAD
     */
    function depositMintAndSell(
        uint256 _collateral,
        uint256 _dToken,
        uint256 _maxSlippage
    ) external override payable nonReentrant {
        raiseNotImplemented();
        require(_collateral == 0 && _dToken == 0 && _maxSlippage == 0);
    }

    /**
     * @notice Repays dToken debt in a vault
     * @param _account is the address which debt is being repaid
     * @param _amount is amount of dToken to repay
     */
    function repayDebt(address _account, uint256 _amount)
        public
        override
        nonReentrant
    {
        raiseNotImplemented();
        require(_account == address(0) && _amount == 0);
    }

    /**
     * @notice Changes `expired` to True if timestamp is greater than expiry
     * It calculates the `settlePrice` with the current prices of target and
     * collateral assets, then sets them in stone.
     */
    function settle() public override {
        raiseNotImplemented();
    }

    /**
     * @notice Redeems dToken for collateral after expiry
     * @param _dTokenAmount is amount of dTokens to redeem
     */
    function redeem(uint256 _dTokenAmount) external override nonReentrant {
        raiseNotImplemented();
        require(_dTokenAmount == 0);
    }

    /**
     * @notice Withdraws collateral after instrument is expired
     */
    function withdrawAfterExpiry() external override nonReentrant {
        raiseNotImplemented();
    }

    /**
     * @notice Raises to prevent calling
     */
    function raiseNotImplemented() private pure {
        require(false, "Not implemented");
    }

    /**
     * @notice returns the cost to purchase Hegic calls and puts
     * @param _amount is the amount of option contracts to purchase
     */
    function getHegicCost(uint256 _amount)
        public
        view
        returns (
            uint256 totalCost,
            uint256 costOfCall,
            uint256 costOfPut
        )
    {
        uint256 _strike = strikePrice;
        uint256 period = expiry - block.timestamp;
        IHegicETHOptions options = IHegicETHOptions(hegicOptions);

        (costOfPut, , , ) = options.fees(
            period,
            _amount,
            _strike,
            OptionType.Put
        );
        (costOfCall, , , ) = options.fees(
            period,
            _amount,
            _strike,
            OptionType.Call
        );
        totalCost = costOfCall + costOfPut;
    }
}
