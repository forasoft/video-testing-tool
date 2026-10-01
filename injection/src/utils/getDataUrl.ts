interface IProps {
  data: string;
  mimeType: string;
}

// A Blob URL of the data: `downloadFile` revokes it once the download has started.
export const getDataUrl = ({ data, mimeType }: IProps) => {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);

  return url;
};
