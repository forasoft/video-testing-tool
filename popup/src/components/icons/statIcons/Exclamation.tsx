// The red ! of a codec without a value.
import React from "react";

interface ExclamationIconProps {
  className: string;
}

export const ExclamationIcon: React.FC<ExclamationIconProps> = ({ className }) => (
  <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M9 16.5C13.1421 16.5 16.5 13.1421 16.5 9C16.5 4.85786 13.1421 1.5 9 1.5C4.85786 1.5 1.5 4.85786 1.5 9C1.5 13.1421 4.85786 16.5 9 16.5Z" stroke="#F25454" strokeWidth="1.5" />
    <path d="M9.75 5C9.75 4.58579 9.41421 4.25 9 4.25C8.58579 4.25 8.25 4.58579 8.25 5H9.75ZM8.25 10C8.25 10.4142 8.58579 10.75 9 10.75C9.41421 10.75 9.75 10.4142 9.75 10H8.25ZM8.25 5V10H9.75V5H8.25Z" fill="#F25454" />
    <path d="M9 13V13.375" stroke="#F25454" strokeWidth="1.5" strokeLinecap="round" />
  </svg>

);
