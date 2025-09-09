
type DelayInfoType = {
    realDelay: number; // JitterBuffer
    modifiedDelay?: number;
    realCount: number;
    modifiedCount?: number;
}

export default class AverageDelaysGenerator {
    lastTen: DelayInfoType[];
    size: number;
    constructor(size: number) {
        this.lastTen = [];
        this.size = size;
    }

    smartPrepand = (delayInfo: DelayInfoType) => {
        if (this.lastTen.length < this.size) {
            this.lastTen.unshift(delayInfo);
        } else {
            delayInfo.modifiedDelay = delayInfo.realDelay - this.lastTen[this.lastTen.length - 1].realDelay;
            delayInfo.modifiedCount = delayInfo.realCount - this.lastTen[this.lastTen.length - 1].realCount;
            this.lastTen.pop()
            this.lastTen.unshift(delayInfo);
        }
    }

    getAverageJBD = () => {
        let sum = 0;
        this.lastTen.forEach((JBInfo) => {
            if(JBInfo.modifiedDelay && JBInfo.modifiedCount) {
                sum += JBInfo.modifiedDelay / JBInfo.modifiedCount;
            } else {
                sum += JBInfo.realDelay / JBInfo.realCount;
            }
        })
        const averageJBD = sum / (this.lastTen.length || 1);
        return averageJBD;
    }

}
