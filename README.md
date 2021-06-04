# Bscgas

We provide information about gas prices on Binance Smart Chain network.

Our server runs an oracle that scans the last hundred transactions on BSC and report an estimate gas price you will need to pay to get your transaction through in a set amount of time. The oracle backend is a fork from [ethgasstation](https://github.com/ethgasstation/gasstation-express-oracle).

This repo contains the frontend website for https://bscgas.info as well as the [API endpoint](https://bscgas.info/gas) exposing the oracle's data in json format:

```{"timestamp":"2021-05-20T04:28:00.465Z","slow":5,"standard":5,"fast":6,"instant":10}```