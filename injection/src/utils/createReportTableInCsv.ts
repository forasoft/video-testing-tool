import { CustomPeerConnection, StatisticsReportItem } from "src/types";
import * as sdpTransform from "sdp-transform";
interface IProps {
  startAt: Date;
  peerConnection: CustomPeerConnection;
  statsLog: StatisticsReportItem[];
}

const escape = (value: string | number): string => {
  const removeComma = `${value}`.replace(/,/g, ";");
  const removeQuots = removeComma.replace(/"/g, '\\"');
  const removeNewLine = removeQuots.replace(/\n/g, " ");

  return `"${removeNewLine}"`;
};

const addSdp = (csvRows: string[], description: RTCSessionDescription) => {
  const parsedSdp: Record<string, any> = sdpTransform.parse(description.sdp);

  const writeObject = (
    obj: Record<string, any>,
    parentKey: string,
    displayLevel: number = 0
  ) => {
    if (parentKey) {
      csvRows.push([...new Array(displayLevel).fill(""), parentKey].join(","));
    }

    Object.keys(obj).forEach((key, i) => {
      if (["string", "number"].includes(typeof obj[key])) {
        return csvRows.push(
          [
            ...new Array(displayLevel + 1).fill(""),
            escape(key),
            escape(obj[key]),
          ].join(",")
        );
      }
      if (Array.isArray(obj[key])) {
        writeArray(obj[key], key, displayLevel + 1);
      } else {
        writeObject(obj[key], key, displayLevel + 1);
      }
    });
  };

  const writeArray = (
    array: any[],
    parentKey: string,
    displayLevel: number
  ) => {
    if (parentKey) {
      csvRows.push([...new Array(displayLevel).fill(""), parentKey].join(","));
    }

    array.forEach((item, i) => {
      if (i > 0) {
        csvRows.push("");
      }

      if (Array.isArray(item)) {
        writeArray(item, "", displayLevel);
      } else {
        writeObject(item, "", displayLevel);
      }
    });
  };

  writeObject(parsedSdp, description.type + " sdp");
};

const MS_IN_S = 1000;
export const createReportTableInCsv = ({
  startAt,
  peerConnection,
  statsLog,
}: IProps): string => {
  const csvRows: string[] = [];
  csvRows.push(
    [
      escape("Report"),
      escape(""),
      escape("timestamp:"),
      escape(Number(new Date()) - Number(startAt) + "ms"),
    ].join(",")
  );
  csvRows.push("");

  addSdp(csvRows, peerConnection.remoteDescription);
  csvRows.push("");
  addSdp(csvRows, peerConnection.localDescription);
  csvRows.push("");

  const groupedReports: Record<string, RTCStatsReport[]> = {};
  const iceConnectionStates: string[] = [];
  const iceGatheringStates: string[] = [];

  const timeRow: string[] = [];

  statsLog.forEach((item) => {
    iceConnectionStates.push(item.iceConnectionState);
    iceGatheringStates.push(item.iceGatheringState);
    timeRow.push(
      Math.trunc((item.timestamp - Number(startAt)) / MS_IN_S) + "s"
    );

    item.stats.forEach((report) => {
      if (groupedReports[report.id]) {
        groupedReports[report.id].push(report);
      } else {
        groupedReports[report.id] = [report];
      }
    });
  });

  csvRows.push(["time", ...timeRow].join(","));
  csvRows.push(["iceConnectionState", ...iceConnectionStates].join(","));
  csvRows.push(["iceGatheringState", ...iceGatheringStates].join(","));
  csvRows.push("");

  Object.values(groupedReports).forEach((reportsArray) => {
    const gruppedProperties: Record<string, string[]> = {};

    reportsArray.forEach((report: Record<string, any>) => {
      Object.keys(report).forEach((key) => {
        if (gruppedProperties[key]) {
          gruppedProperties[key].push(escape(report[key]));
        } else {
          gruppedProperties[key] = [escape(report[key])];
        }
      });
    });

    csvRows.push(`type=${gruppedProperties.type[0]}`);
    csvRows.push(["time", ...timeRow].join(","));

    delete gruppedProperties.type;
    Object.entries(gruppedProperties).forEach(([name, values]) => {
      csvRows.push([name, ...values].join(","));
    });

    csvRows.push("");
  });

  return csvRows.join("\n");
};
