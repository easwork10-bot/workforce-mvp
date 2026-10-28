import type { ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
};

export default function Image({
  fill: _fill,
  priority = false,
  unoptimized: _unoptimized,
  loading,
  ...props
}: Props) {
  return <img {...props} loading={priority ? "eager" : loading ?? "lazy"} />;
}
