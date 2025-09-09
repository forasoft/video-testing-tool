import React from "react";

interface IProps {
  className?: string;
  onClick: () => void;
}

const Button: React.FC<IProps> = (props) => {
  const { onClick, className, children } = props;

  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
};

export default Button;
