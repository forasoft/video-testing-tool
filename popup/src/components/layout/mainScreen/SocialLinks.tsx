import React from "react";

interface ISocialProps {
  Icon: React.FC;
  url: string;
}

export const SocialLink: React.FC<ISocialProps> = ({ Icon, url }) => (
  <a href={url} target="_blank" rel="noreferrer">
    {" "}
    <Icon />
    {" "}
  </a>
);
