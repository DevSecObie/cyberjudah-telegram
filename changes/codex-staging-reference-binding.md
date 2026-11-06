# Preserve staging's existing Nave publication service

The staging Worker manifest now retains its deployed `nave-self-hosted` setting and reference-service binding. A subsequent staging deployment will therefore keep routing Nave requests to the existing CyberJudah resource service. Production reference settings and account-deletion gates are unchanged.
