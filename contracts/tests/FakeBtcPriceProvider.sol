pragma solidity >=0.7.2;
interface AggregatorV3Interface {

  function decimals() external view returns (uint8);
  function description() external view returns (string memory);
  function version() external view returns (uint256);

  // getRoundData and latestRoundData should both raise "No data present"
  // if they do not have data to report, instead of returning unset values
  // which could be misinterpreted as actual reported values.
  function getRoundData(uint80 _roundId)
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );

}
contract FakePriceProvider is AggregatorV3Interface {
    uint256 public price;
    uint8 public override decimals = 8;
    string public override description = "Test implementatiln";
    uint256 public override version = 0;

    constructor(uint256 _price) public {
        price = _price;
    }

    function setPrice(uint256 _price) external {
        price = _price;
    }

    function getRoundData(uint80) external override view returns (uint80, int256, uint256, uint256, uint80) {
        revert("Test implementation");
    }

    function latestAnswer() external view returns(int result) {
        (, result, , , ) = latestRoundData();
    }

    function latestRoundData()
        public
        override
        view
        returns (
            uint80,
            int256 answer,
            uint256,
            uint256,
            uint80
        )
    {
        answer = int(price);
    }
}


contract FakeBTCPriceProvider is FakePriceProvider {
    constructor(uint price) public FakePriceProvider(price) {}
}