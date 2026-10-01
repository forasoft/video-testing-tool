import React from "react";

interface ISocialProps {
  Icon: React.FC;
  url: string;
  // The link's name for screen readers: it shows an icon only.
  label: string;
}

export const SocialLink: React.FC<ISocialProps> = ({ Icon, url, label }) => (
  <a href={url} target="_blank" rel="noreferrer" aria-label={label}>
    {" "}
    <Icon />
    {" "}
  </a>
);
