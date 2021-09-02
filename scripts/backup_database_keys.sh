##!/bin/bash

DATA=`date +%Y-%m-%d-%H-%M`

mysqldump bscgas_ api_keys credit_recharges > $DATA.sql
gzip $DATA.sql
rclone copy $DATA.sql.gz gdrive:/1NOSYNC/bscgas_backup/
rm -rf $DATA.sql.gz

