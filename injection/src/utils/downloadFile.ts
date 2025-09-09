interface IProps {
  url: string;
  fileName: string;
}

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
