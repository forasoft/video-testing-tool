interface IProps {
  data: string;
  mimeType: string;
}

export const getDataUrl = ({ data, mimeType }: IProps) => {
  const blob = new Blob([data], { type: mimeType });
  const url = window.URL.createObjectURL(blob);

  return url;
};
