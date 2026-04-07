import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const VALID_TYPES = [
  'text', 'textarea', 'number', 'choice', 'multi', 'dropdown',
  'scale', 'rating', 'slider', 'date', 'time', 'datetime', 'yesno',
  'email', 'phone', 'url', 'static_text', 'file_upload', 'image_upload', 'matrix_simple',
];

export class UpdateQuestionDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  internalKey?: string;

  @IsOptional()
  @IsIn(VALID_TYPES)
  questionType?: string;

  @IsOptional()
  @IsString()
  helperText?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  allowOther?: boolean;

  @IsOptional()
  @IsIn(['sm', 'md', 'lg'])
  fieldSize?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
