##!/bin/bash

DATA=`date +%Y-%m-%d-%H-%M`

mysqldump bscgas_ api_keys credit_recharges > keys-$DATA.sql
gzip keys-$DATA.sql
rclone copy keys-$DATA.sql.gz gdrive:/1NOSYNC/bscgas_backup/
rm -rf keys-$DATA.sql.gz

