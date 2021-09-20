const Web3 = require('web3');
const BN = require('bn.js');

const rpc = {
    last: 0,
    connected: false,
    blocks: {},
    sampleSize: 200, // number of samples analized
    speedSize: [35, 60, 90, 100], // percent of blocks accepted for each speed

    connect: function(network){
        const url = {
            polygon: 'https://rpc-mainnet.maticvigil.com',
        }

        console.log('Starting gas oracle...');

        try {
            this.web3 = new Web3(url[network || 'polygon']);
            this.connected = true;
            process.stdout.write(`RPC connected. Fetching ${this.sampleSize} blocks before making predictions.\n`);
        }
        catch(error){
            console.log(error);
            return new Error(error);
        }

        return true;
    },

    getBlock: async function(num) {
        if (!this.connected){
            return new Error('Not connected');
        }

        try {
            const block = await this.web3.eth.getBlock(num || 'latest', true);
            return block;
        }
        catch(error){
            // console.log(error);
            return new Error(error);
        }
    },

    loop: async function(){
        try {
            // get a block
            const block = await this.getBlock(this.last || 'latest');
            const sortedBlocks = Object.keys(this.blocks).sort();
            if (block && block.transactions){
                // save the block
                this.recordBlock(block);
                this.last = block.number + 1;
            }
            else if (sortedBlocks.length < this.sampleSize){
                // there is not a next block yet, fetch a previous block
                const block = await this.getBlock(sortedBlocks[0] - 1);
                this.recordBlock(block);
            }
    
            setTimeout(() => this.loop(), 10);
        }
        catch (error){
            console.log(error);
        }
    },

    recordBlock: function(block) {
        // extract the gas from transactions
        const gasPrice = block.transactions.map(t => t.gasPrice);
        this.blocks[block.number] = {
            ntx: gasPrice.length,
            timestamp: block.timestamp,
            minGwei: Math.min(...gasPrice.map(g => parseFloat(this.web3.utils.fromWei(g, 'gwei')))),
        };

        // sort the blocks and discard if higher than sampleSize
        const sortedBlocks = Object.keys(this.blocks).sort();
        if (sortedBlocks.length > this.sampleSize){
            delete this.blocks[sortedBlocks[0]];

            this.calcSpeeds();
        }
        else{
            process.stdout.write(`\r${sortedBlocks.length} / ${this.sampleSize}`);
        }
    },

    calcSpeeds: function(){
        // sort blocks by timestamp, then remove blocks with no tx
        const b = Object.values(this.blocks).sort((a,b) => a.timestamp - b.timestamp).filter(e => e.ntx);
        
        const avgTx = b.map(e => e.ntx).reduce((p,c) => p+c, 0) / b.length;
        // avg time between the sample
        const avgTime = (b.slice(-1)[0].timestamp - b[0].timestamp) / (b.length - 1);
        
        // sort gwei array ascending so I can pick directly by index
        const sortedGwei = b.map(e => e.minGwei).sort((a,b) => parseFloat(a) - parseFloat(b));
        const speeds = this.speedSize.map(speed => {
            // get gwei corresponding to the slice of the array
            const poolIndex = parseInt(speed / 100 * b.length) - 1;
            return sortedGwei[poolIndex];
        });

        process.stdout.write(`\nLast Block: ${this.last}\tAvgTx: ${avgTx}\tAvgTime: ${avgTime}\tSpeed: ${speeds.map(e => e.toFixed(2))}`);    
    },

    getPending: async function(){
        const b = await this.web3.eth.getBlock('pending');
        const t = await this.web3.eth.getTransaction(b.transactions[0]);
        // const a = await this.web3.eth.getBlock('0xa3d0a45b1b027d37f480e47dc5d9d8ce2f8513f1676a65df9c536418139c77f2');
        console.log(t)

    }
}

rpc.connect();
rpc.loop();
// rpc.getBlock(19147009).then(block => {
//     const gas = block.transactions.map(t => t.gasPrice);

//     // calculate the average using big numbers
//     const totalGas = gas.reduce((p,c) => p.add(new BN(c, 10)), new BN('0', 10)).toString(10);
//     const avgGasPrice = gas.length ? new BN(totalGas, 10).div(new BN(gas.length, 10)) : 0;
//     console.log(...gas, avgGasPrice.toString(), totalGas);
// })
// rpc.getPending();