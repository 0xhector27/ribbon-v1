const { createOrder, signTypedDataOrder } = require("@airswap/utils");

module.exports = {
  signOrderForSwap,
};

const SWAP_CONTRACT = "0x4572f2554421Bd64Bef1c22c8a81840E8D496BeA";

async function signOrderForSwap({
  vaultAddress,
  counterpartyAddress,
  sellToken,
  buyToken,
  sellAmount,
  buyAmount,
  signerPrivateKey,
}) {
  let order = createOrder({
    signer: {
      wallet: vaultAddress,
      token: sellToken,
      amount: sellAmount,
    },
    sender: {
      wallet: counterpartyAddress,
      token: buyToken,
      amount: buyAmount,
    },
  });

  const signedOrder = signTypedDataOrder(
    order,
    signerPrivateKey,
    SWAP_CONTRACT
  );
  return signedOrder;
}
