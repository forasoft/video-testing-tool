// Downloads from the page itself: the export files of a session (requests.ts).

interface IProps {
  url: string;
  fileName: string;
}

// Clicks a hidden <a download>; without `fileName` the file is named after the URL's last part. The link and the
// Blob URL go 10 ms later, once the download has started.
export const downloadFile = ({ url, fileName }: IProps): void => {
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";

  const download = fileName || url.split("/").pop();

  a.setAttribute("download", download as string);
  a.setAttribute("target", "_blank");

  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 10);
};
