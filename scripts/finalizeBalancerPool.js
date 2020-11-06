const program = require("commander");
const web3 = require("./helpers/web3");
const { sleep } = require("./helpers/utils");
const accounts = require("../constants/accounts.json");
const twinYieldJSON = require("../build/contracts/TwinYield.json");
const IERC20JSON = require("../build/contracts/IERC20.json");

program.requiredOption(
  "-i, --instrument <address>",
  "instrument address to finalize the pool"
);

program.option("-n, --network <network>", "ethereum network name", "kovan");

program.parse(process.argv);

const instrumentAddress = web3.utils.toChecksumAddress(program.instrument);
const MIN_BALANCE = "1000000";

async function finalizeBalancerPool() {
  try {
    const instrument = new web3.eth.Contract(
      twinYieldJSON.abi,
      instrumentAddress
    );
    const symbol = await instrument.methods.symbol().call();
    const paymentToken = await instrument.methods.paymentToken().call();
    const dToken = await instrument.methods.dToken().call();
    const paymentERC20 = new web3.eth.Contract(IERC20JSON.abi, paymentToken);
    const dTokenERC20 = new web3.eth.Contract(IERC20JSON.abi, dToken);

    const owner = accounts[program.network].owner;

    console.log(`Finalizing the instrument ${symbol}`);

    await depositAndMintDtoken(instrument, owner);

    // First we need to transfer the min amount to the pool, which is 10**6
    console.log("Transferring the paymentToken for the pool's MIN_BALANCE");
    const paymentReceipt = await paymentERC20.methods
      .transfer(instrumentAddress, MIN_BALANCE)
      .send({ from: owner });
    console.log(
      `Transfer txhash: https://kovan.etherscan.io/tx/${paymentReceipt.transactionHash}\n`
    );
    sleep(60000);

    console.log("Transferring the dToken for the pool's MIN_BALANCE");
    const dTokenReceipt = await dTokenERC20.methods
      .transfer(instrumentAddress, MIN_BALANCE)
      .send({ from: owner });
    console.log(
      `Transfer txhash: https://kovan.etherscan.io/tx/${dTokenReceipt.transactionHash}\n`
    );
    sleep(60000);

    console.log("Calling finalizePool");
    const finalizeReceipt = await instrument.methods
      .finalizePool()
      .send({ from: owner });
    console.log(
      `Finalizing txhash: https://kovan.etherscan.io/tx/${finalizeReceipt.transactionHash}\n`
    );

    console.log("Finalization process completed 🎉");

    process.exit();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

async function depositAndMintDtoken(instrument, owner) {
  const collateralAsset = await instrument.methods.collateralAsset().call();
  const dToken = await instrument.methods.dToken().call();
  const dTokenERC20 = new web3.eth.Contract(IERC20JSON.abi, dToken);
  const collateralERC20 = new web3.eth.Contract(
    IERC20JSON.abi,
    collateralAsset
  );

  console.log("Approving collateralAsset");
  const approveReceipt = await collateralERC20.methods
    .approve(instrumentAddress, MIN_BALANCE)
    .send({ from: owner });
  console.log(
    `Approve txhash: https://kovan.etherscan.io/tx/${approveReceipt.transactionHash}\n`
  );
  sleep(60000);

  console.log("Performing an initial depositAndMint to mint dTokens");
  const mintReceipt = await instrument.methods
    .depositAndMint(MIN_BALANCE, MIN_BALANCE)
    .send({ from: owner });
  console.log(
    `Minting txhash: https://kovan.etherscan.io/tx/${mintReceipt.transactionHash}\n`
  );
  sleep(60000);

  const dTokenBalance = await dTokenERC20.methods.balanceOf(owner);

  if (dTokenBalance < MIN_BALANCE) {
    throw new Error(
      `dToken balance for ${owner} (${dTokenBalance}) is less than ${MIN_BALANCE}`
    );
  }
  console.log("Sufficient dToken balance for funding balancer pool.");
}

finalizeBalancerPool();
