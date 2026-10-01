// The links of the start screen's footer, after the ForaSoft logo.
import { GlobeIcon } from "./globe";
import { LinkedInIcon } from "./linedIn";
import { OctocatIcon } from "./octocat";
import { YoutubeIcon } from "./youtube";

// In the order shown; `label` names the link for screen readers, as it shows the icon alone.
export const mediaIcons = [
  {
    icon: GlobeIcon,
    url: "https://www.forasoft.com/",
    label: "ForaSoft website",
  },
  {
    icon: OctocatIcon,
    url: "https://github.com/forasoft",
    label: "GitHub",
  },
  {
    icon: YoutubeIcon,
    url: "https://youtube.com/user/forasoft",
    label: "YouTube",
  },
  {
    icon: LinkedInIcon,
    url: "https://www.linkedin.com/company/fora-soft-llc-/mycompany/",
    label: "LinkedIn",
  },
];
