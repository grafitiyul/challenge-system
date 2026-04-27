import { IsArray, IsInt, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ReorderItem {
  @IsString()
  id!: string;

  @IsInt()
  sortOrder!: number;
}

export class ReorderFieldsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderItem)
  items!: ReorderItem[];
}
