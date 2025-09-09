
export class Queue {
    storage: number[];
    size: number;
    lastSmartAppendTimestamp: number;
    constructor(size: number) {
        this.storage = [];
        this.size = size;
        this.lastSmartAppendTimestamp = Date.now();
    }

    smartAppend = (time: number) => { 
        if (this.storage.length < this.size) {
            this.storage.push(time);
        } else {
            this.storage.shift();
            this.storage.push(time);
        }
        this.lastSmartAppendTimestamp = Date.now();
    }

    getAverage = () => {
        let sum = 0;
        this.storage.forEach((time) => {
            sum += time;
        })
        const average = sum / (this.storage.length || 1);
        return average;
    }

}
